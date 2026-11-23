//! Helpers of oxlint 1.87's rules, under their oxlint names. Rules use them when they run with an oxlint configuration.

use super::ancestor_memo::AncestorMemo;
use super::ast_utils::is_global_reference;
use crate::ast::{
    Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Ident, Key, KeyKind, List, Member,
    MemberKind, ModuleName, Node, Prop, PropKind, Stmt, StmtKind, StmtTag, VarDecl, VarKind,
};
use crate::language::{LanguageOptions, SourceType};
use crate::semantic::{Declaration, Scope, ScopeKind, Symbol};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use smallvec::SmallVec;

/// In a file that can be a script or a module, an `await` outside any function makes the file a module if what follows
/// can only be its operand.
fn is_unambiguous_await<'a>(e: Expr<'a>, in_function: &mut AncestorMemo<'a, ()>) -> bool {
    let (file, after) = (e.file(), e.span().start + 5);
    let next = skip_trivia(file.text(), after);
    let rest = file.text().get(next as usize..).unwrap_or_default();
    let starts_operand = match rest.first() {
        Some(b'"' | b'\'' | b'0'..=b'9') => true,
        Some(b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80..) => !matches!(
            rest.get(..token_len(rest)),
            Some(b"of" | b"using" | b"in" | b"instanceof")
        ),
        _ => false,
    };
    starts_operand
        && !bun_core::strings::contains_js_line_break(file.slice(Span::new(after, next)))
        && in_function
            .find(Node::Expr(e), |_, parent| parent.as_func().map(|_| ()))
            .is_none()
}

/// tsgolint's `rule.ListenerOnAllowPattern`: true if the `patternVisitor` of `visitLintNodes` reaches this array or
/// object. It starts at the left of a `=` and descends through elements, property values and spreads. It doesn't reach
/// the left of a default in a pattern or the head of a `for`.
pub fn is_visited_as_pattern(node: Expr) -> bool {
    let (mut at, mut allows_pattern) = (node, false);
    loop {
        if at.is_parenthesized() {
            return allows_pattern;
        }
        at = match at.parent() {
            Node::Expr(parent) => match parent.as_assign() {
                // The left side of an assignment that's itself in a pattern is visited as an expression.
                Some((None, left, _)) if left == at => {
                    allows_pattern = !allows_pattern;
                    parent
                }
                None if matches!(parent.tag(), ExprTag::Array | ExprTag::Spread) => parent,
                _ => return allows_pattern,
            },
            Node::Prop(property)
                if property.value() == Some(at)
                    && matches!(property.kind(), PropKind::Init | PropKind::Spread)
                    && !property.is_jsx_attribute() =>
            {
                match property.parent() {
                    Node::Expr(object) => object,
                    _ => return allows_pattern,
                }
            }
            _ => return allows_pattern,
        };
    }
}

/// True if the file's name allows both a script and a module. The scripts in `.vue` and `.svelte` files are modules.
pub(crate) fn can_be_script_or_module(file: &File) -> bool {
    !matches!(
        file.path(),
        [.., b'.', b'm' | b'c', b'j' | b't', b's']
            | [.., b'.', b'v', b'u', b'e']
            | [.., b'.', b's', b'v', b'e', b'l', b't', b'e']
    )
}

/// True if oxc treats the file as a script, where the `await` in an `await (a)` outside any function is a function's
/// name.
pub fn is_script<'a>(file: &'a File<'a>) -> bool {
    can_be_script_or_module(file) && !has_module_syntax(file)
}

/// `ModuleRecord::has_module_syntax`
pub fn has_module_syntax<'a>(file: &'a File<'a>) -> bool {
    let is_module_declaration = |stmt: Stmt| {
        matches!(
            stmt.tag(),
            StmtTag::Import
                | StmtTag::ExportNamed
                | StmtTag::ExportStar
                | StmtTag::ExportDefault
                | StmtTag::ExportAssign
                | StmtTag::ExportAsNamespace
        ) || stmt.is_exported()
    };
    let is_await_using = |stmt: &Stmt| match stmt.as_var() {
        Some(declarations) => {
            (declarations.first()).is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
        }
        _ => false,
    };
    let mut in_function = AncestorMemo::default();
    file.body().iter().any(is_module_declaration)
        || file.has_exprs([ExprTag::ImportMeta])
        || file.has_exprs([ExprTag::Await])
            && can_be_script_or_module(file)
            && file
                .exprs_of_kind(ExprTag::Await)
                .any(|it| is_unambiguous_await(it, &mut in_function))
        || can_be_script_or_module(file)
            && (file.stmts_of_kind(StmtTag::Var).filter(is_await_using)).any(|it| {
                in_function
                    .find(Node::Stmt(it), |_, parent| parent.as_func().map(|_| ()))
                    .is_none()
            })
}

/// `ctx.source_type()`: what oxc treats the file as. `.mjs` and `.mts` are modules, and so are the scripts in `.vue`
/// and `.svelte` files. `.cjs` and `.cts` are CommonJS. Any other file is a module if it has an `import` or an
/// `export`, otherwise a script. [`File::language`] doesn't tell: with an oxlint configuration every file gets a
/// module's scopes, which is what oxc's scopes look like for any file. Few oxlint rules need this.
pub fn source_type<'a>(file: &'a File<'a>) -> SourceType {
    *file.lazy.oxc_source_type.get_or_init(|| match file.path() {
        [.., b'.', b'm', b'j' | b't', b's'] | [.., b'.', b'v', b'u', b'e'] => SourceType::Module,
        [.., b'.', b's', b'v', b'e', b'l', b't', b'e'] => SourceType::Module,
        [.., b'.', b'c', b'j' | b't', b's'] => SourceType::CommonJs,
        _ if has_module_syntax(file) => SourceType::Module,
        _ => SourceType::Script,
    })
}

/// `ScopeFlags::is_strict_mode` of oxc's scope: in a module, in a class, or below a `"use strict"`.
/// [`Scope::is_strict`] treats every file as a module.
pub fn is_strict_mode<'a>(scope: Scope<'a>, file: &'a File<'a>) -> bool {
    let has_use_strict = |statements: List<'a, Stmt<'a>>| {
        let mut directives = statements.iter().map_while(Stmt::directive);
        directives.any(|it| it == b"use strict")
    };
    source_type(file) == SourceType::Module
        || scope.chain().any(|it| match (it.kind(), it.node()) {
            (ScopeKind::Class, _) => true,
            (_, Node::Func(func)) => func.body_statements().is_some_and(has_use_strict),
            (_, Node::File(file)) => has_use_strict(file.body()),
            _ => false,
        })
}

/// True if a rule that now resolves what `Boolean`, `Promise` or `NaN` refers to should only check the name. Its oxlint
/// port does that, and so did the rule before ESLint 10. ESLint 8 configurations only have `Promise` if `env` enables
/// it.
pub fn checks_name_only(language: &LanguageOptions) -> bool {
    language.is_oxlint || language.eslint_major < 10
}

/// [`is_global_reference`] for such a rule. Where it [`checks_name_only`], any `e` counts, because the caller has
/// already checked the name.
pub fn is_global_by_name(e: Expr) -> bool {
    checks_name_only(e.file().language()) || is_global_reference(e)
}

/// True if `scope` belongs to a class, or to a function or file that begins with `"use strict"`. oxc then treats it and
/// everything in it as strict, whatever the file is. It's for a rule that checks many scopes of a file that it knows
/// isn't a module.
pub fn makes_strict(scope: crate::semantic::Scope<'_>) -> bool {
    fn has_use_strict<'a>(statements: crate::ast::List<'a, crate::ast::Stmt<'a>>) -> bool {
        let mut directives = statements.iter().map_while(crate::ast::Stmt::directive);
        directives.any(|it| it == b"use strict")
    }
    match (scope.kind(), scope.node()) {
        (crate::semantic::ScopeKind::Class, _) => true,
        (_, Node::Func(func)) => func.body_statements().is_some_and(has_use_strict),
        (_, Node::File(file)) => has_use_strict(file.body()),
        _ => false,
    }
}

/// tsgolint 7.0's `GetFunctionHeadLoc`. For an arrow function it's the `=>` plus whatever is between it and the
/// previous token. For any other function it runs from the first modifier that isn't a decorator, or else from the
/// first token, to the `(`. It doesn't include the key of a property whose value is the function.
pub fn tsgolint_function_head_loc(func: Func) -> Span {
    if let Some(arrow) = func.arrow_span() {
        let start = func.file().end_of_token_before(arrow.start);
        return Span::new(start, arrow.end);
    }
    let whole = func.span();
    let modifier = match func.owner() {
        Node::Member(member) => member
            .modifiers()
            .iter()
            .find(|it| it.decorator().is_none()),
        _ => None,
    };
    let start = modifier.map_or(whole.start, |it| it.span().start);
    match func.open_paren() {
        Some(end) if start <= end => Span::new(start, end),
        _ => whole,
    }
}

/// True if every declaration of `symbol` is a namespace that contains only types. oxc then doesn't treat it as a value.
pub fn is_namespace_of_types(symbol: Symbol) -> bool {
    let mut pending = Vec::new();
    for declaration in symbol.declarations() {
        let Declaration::Module(module) = declaration else {
            return false;
        };
        pending.push(module);
    }
    let is_declared = !pending.is_empty();
    while let Some(module) = pending.pop() {
        for statement in module.innermost().body() {
            match statement.kind() {
                StmtKind::Interface(_) | StmtKind::TypeAlias(_) => {}
                StmtKind::ImportEquals(_) if !statement.flags().contains(Flags::EXPORT) => {}
                StmtKind::Module(inner) => pending.push(inner),
                _ => return false,
            }
        }
    }
    is_declared
}

/// `has_ambient_typescript_ancestor`, cached for many of a file's nodes.
#[derive(Default)]
pub struct AmbientAncestors<'a>(AncestorMemo<'a, ()>);

impl<'a> AmbientAncestors<'a> {
    /// True if `node` is in a `declare namespace`, a `declare module` or a `global`.
    pub fn has_ambient_typescript_ancestor(&mut self, node: Node<'a>) -> bool {
        let is_ambient = |_, parent: Node<'a>| match parent {
            Node::Stmt(statement) => match statement.as_module() {
                Some(module) => {
                    let is_ambient = matches!(module.name(), ModuleName::Global)
                        || statement.flags().contains(Flags::AMBIENT);
                    is_ambient.then_some(())
                }
                _ => None,
            },
            _ => None,
        };
        self.0.find(node, is_ambient).is_some()
    }
}

/// A function's parent in oxlint, where a parenthesized function's parent is the parentheses.
#[derive(Copy, Clone)]
pub enum FunctionParent<'a> {
    MethodDefinition(Member<'a>),
    /// The function is the value of the field.
    PropertyDefinition(Member<'a>),
    ObjectProperty(Prop<'a>),
    VariableDeclarator(VarDecl<'a>),
    Other,
}

impl<'a> FunctionParent<'a> {
    pub fn of(func: Func<'a>) -> FunctionParent<'a> {
        let is_in_class = |member: Member<'a>| matches!(member.parent(), Node::Class(_));
        match func.owner() {
            Node::Member(member) if is_in_class(member) && func.kind() != FnKind::StaticBlock => {
                FunctionParent::MethodDefinition(member)
            }
            Node::Prop(prop) => FunctionParent::ObjectProperty(prop),
            Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
                Node::Member(member)
                    if is_in_class(member)
                        && member.init() == Some(e)
                        && !member.flags().contains(Flags::ACCESSOR) =>
                {
                    FunctionParent::PropertyDefinition(member)
                }
                Node::Prop(prop) if !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread => {
                    FunctionParent::ObjectProperty(prop)
                }
                Node::VarDecl(declarator) => FunctionParent::VariableDeclarator(declarator),
                _ => FunctionParent::Other,
            },
            _ => FunctionParent::Other,
        }
    }
}

/// The name of a computed key that's a literal other than a string or a number: `[null]`, `[/a/]`, `[1n]`.
fn name_of_computed_literal(e: Expr<'_>) -> Option<&[u8]> {
    match e.kind() {
        _ if e.is_parenthesized() => None,
        ExprKind::Null => Some(&b"null"[..]),
        ExprKind::Regex(_) => Some(e.text()),
        ExprKind::BigInt(_) => e.text().strip_suffix(b"n"),
        _ => None,
    }
}

/// `PropertyKey::name`, for a key that's a name or a literal. For `#a` it's `a`.
pub fn property_key_name(key: Key<'_>) -> Option<&[u8]> {
    match key.kind() {
        KeyKind::Private(name) => {
            let name = name.bytes();
            Some(name.strip_prefix(b"#").unwrap_or(name))
        }
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => Some(name.bytes()),
        KeyKind::Computed(e) => name_of_computed_literal(e),
    }
}

/// A `PropertyKey`'s span, which excludes the brackets but includes the parentheses inside them.
pub fn property_key_span<'a>(key: Key<'a>, file: &File<'a>) -> Span {
    match key.kind() {
        KeyKind::Computed(e) => e.outer_span(),
        _ => key.inner_span(file),
    }
}

/// [`property_key_name`] of a class member's key. In oxlint a constructor has one too.
pub fn member_key_name(member: Member<'_>) -> Option<&[u8]> {
    match member.key() {
        Some(key) => property_key_name(key),
        None => member.constructor_keyword().map(Ident::bytes),
    }
}

/// `get_static_property_name` of the key. A string or a number has none.
fn get_static_property_name<'a>(key: Key<'a>, file: &File<'a>) -> Option<&'a [u8]> {
    let key_text = || file.slice(key.inner_span(file));
    match key.kind() {
        KeyKind::Ident(_) | KeyKind::Private(_) => property_key_name(key),
        KeyKind::Number(name) if key_text().ends_with(b"n") => Some(name.bytes()),
        KeyKind::ComputedString(name) if key_text().starts_with(b"`") => Some(name.bytes()),
        KeyKind::Computed(e) => name_of_computed_literal(e),
        _ => None,
    }
}

/// `get_function_name_with_kind`: ``function `a` ``, ``private static async method `b` ``. An arrow function is a
/// `function`.
pub fn get_function_name_with_kind(func: Func) -> Vec<u8> {
    let (file, parent) = (func.file(), FunctionParent::of(func));
    let mut tokens: SmallVec<[&[u8]; 6]> = SmallVec::new();
    let mut key_name = None;
    match parent {
        FunctionParent::MethodDefinition(member) | FunctionParent::PropertyDefinition(member) => {
            let flags = member.flags();
            if member.key().is_some_and(Key::is_private) || flags.contains(Flags::PRIVATE) {
                tokens.push(b"private");
            } else if flags.contains(Flags::PROTECTED) {
                tokens.push(b"protected");
            } else if flags.contains(Flags::PUBLIC) {
                tokens.push(b"public");
            }
            if member.is_static() {
                tokens.push(b"static");
            }
            key_name = match member.key() {
                Some(key) => get_static_property_name(key, file),
                None => (member.constructor_keyword())
                    .filter(|it| !it.is_string())
                    .map(Ident::bytes),
            };
        }
        FunctionParent::ObjectProperty(prop) => {
            key_name = prop.key().and_then(|it| get_static_property_name(it, file));
        }
        FunctionParent::VariableDeclarator(_) | FunctionParent::Other => {}
    }
    if func.is_async() {
        tokens.push(b"async");
    }
    if func.is_generator() {
        tokens.push(b"generator");
    }
    tokens.push(match parent {
        FunctionParent::MethodDefinition(member) => match member.kind() {
            _ if member.is_constructor() => b"constructor",
            MemberKind::Getter => b"getter",
            MemberKind::Setter => b"setter",
            _ => b"method",
        },
        FunctionParent::PropertyDefinition(_) => b"method",
        _ => b"function",
    });
    let mut out = tokens.join(&b' ');
    if let Some(name) = key_name.or_else(|| func.name().map(Ident::bytes)) {
        out.extend_from_slice(b" `");
        out.extend_from_slice(name);
        out.push(b'`');
    }
    out
}

/// The position where oxlint looks for `@ts-ignore` and the like in a line of a comment: after any number of `/`, and
/// of `*` in a block comment, with whitespace between them.
pub fn after_comment_decoration(mut line: &[u8], is_block: bool) -> &[u8] {
    loop {
        line = match bun_core::strings::trim_unicode_whitespace_start(line) {
            [b'/', after @ ..] => after,
            [b'*', after @ ..] if is_block => after,
            trimmed => return trimmed,
        };
    }
}

/// `format_word_list`: `a`, `a and b`, `a, b, and c`.
pub fn format_word_list(words: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, word) in words.iter().enumerate() {
        match i {
            0 => {}
            _ if i + 1 < words.len() => out.extend_from_slice(b", "),
            _ if words.len() == 2 => out.extend_from_slice(b" and "),
            _ => out.extend_from_slice(b", and "),
        }
        out.extend_from_slice(word);
    }
    out
}
