//! Names that are keywords in some places, `eval` and `arguments`: oxc's `check_identifier`, `check_binding_identifier` and
//! `check_identifier_reference`, which the pass that builds its scopes runs on every identifier, and what its parser says
//! about such a name.
//!
//! The parser notes where such a name is an identifier. Few files have one, and no other file is looked at.

use super::{Stage, SyntaxError};
use crate::ast::{
    self, Class, Expr, ExprKind, File, Flags, FnKind, Func, Handle, MemberKind, Node, Pat, Stmt,
    StmtKind, StmtTag, TypeKind, TypeNode, TypeParam, UnOp, VarDecl, VarKind,
};
use crate::language::SourceType;
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::utils::oxlint::{is_either, source_type};
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{self, DiagnosticKind, PatKind, TypeNodeKind};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// oxc's `BindingIdentifier`, `IdentifierReference` and `LabelIdentifier`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Role {
    Binding,
    Reference,
    Label,
}

struct Checks<'a> {
    file: &'a File<'a>,
    is_module: bool,
    /// Only oxc's parser has something to say about the names in a declaration file.
    is_declaration_file: bool,
    /// Where the parser has noted such a name, sorted, and whether what is there has been looked at.
    noted: SmallVec<[(u32, bool); 8]>,
    /// How many of `noted` have not been looked at.
    left: usize,
    /// The names that oxc's parser has an error about. It has one at most about a name.
    settled: SmallVec<[u32; 4]>,
    read_again: OnceCell<Vec<Span>>,
    errors: Vec<SyntaxError>,
}

fn has_use_strict<'a>(statements: impl Iterator<Item = Stmt<'a>>) -> bool {
    let mut statements = statements;
    let mut directives = std::iter::from_fn(|| statements.next()?.directive());
    directives.any(|it| it == b"use strict")
}

/// Why the code at a name is strict. oxlint says so in a note.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Strict {
    No,
    Class,
    Module,
    Directive,
}

impl<'a> Checks<'a> {
    fn error(&self, at: u32, message: Vec<u8>) -> SyntaxError {
        let rest = self.file.text().get(at as usize..).unwrap_or_default();
        SyntaxError::of_oxc(Span::new(at, at + token_len(rest) as u32), message)
    }

    /// What is at `at` has been looked at.
    fn look_at(&mut self, at: u32) {
        if let Ok(index) = self.noted.binary_search_by_key(&at, |it| it.0)
            && let Some(it) = self.noted.get_mut(index)
            && !it.1
        {
            it.1 = true;
            self.left -= 1;
        }
    }

    /// The token after `at`: where it starts, its text, which is empty at the end of the file, and whether it is on the line
    /// of `at`.
    fn token_after(&self, at: u32) -> (u32, &'a [u8], bool) {
        let file = self.file;
        let next = skip_trivia(file.text(), at);
        let rest = file.text().get(next as usize..).unwrap_or_default();
        let between = file.slice(Span::new(at, next));
        (
            next,
            rest.get(..token_len(rest)).unwrap_or_default(),
            !bun_core::strings::contains_js_line_break(between),
        )
    }

    /// oxc's `Kind::is_after_await_or_yield` of the token after `end`, if that is on the same line: it is a name, a keyword or a
    /// literal, and no operator.
    fn has_operand_after(&self, end: u32) -> bool {
        let (_, token, is_on_line) = self.token_after(end);
        is_on_line
            && match token {
                b"in" | b"instanceof" => false,
                [b'"' | b'\'' | b'.' | b'0'..=b'9', ..] => token != b"." && token != b"...",
                [first, ..] => {
                    first.is_ascii_alphabetic() || matches!(first, b'_' | b'$' | b'\\' | 0x80..)
                }
                [] => false,
            }
    }

    /// Whether oxc's parser has taken the file for a module when it is at `at`, which is in no function. By its name, or from
    /// the first statement on that only a module has. It knows that after the statement, but for an `export`.
    fn is_module_at(&self, at: u32) -> bool {
        if !self.is_module || !is_either(self.file) {
            return self.is_module;
        }
        let file = self.file;
        let is_export = |it: Stmt<'a>| {
            matches!(
                it.tag(),
                StmtTag::ExportNamed
                    | StmtTag::ExportStar
                    | StmtTag::ExportDefault
                    | StmtTag::ExportAssign
                    | StmtTag::ExportAsNamespace
            )
        };
        let mut start = at;
        for it in file.body() {
            let span = it.span();
            if span.end <= at {
                if it.tag() == StmtTag::Import || is_export(it) || it.is_exported() {
                    return true;
                }
                continue;
            }
            let is_after_export = match it.export_span() {
                Some(export) => export.start <= at,
                None => is_export(it),
            };
            if is_after_export {
                return true;
            }
            if self.is_read_again(at) {
                return true;
            }
            start = span.start.min(at);
            break;
        }
        // `import.meta`, and an `await` that can be nothing but the operator.
        file.hir.exprs.iter().enumerate().any(|(i, raw)| {
            raw.pos < start
                && match raw.kind {
                    hir::ExprKind::ImportMeta => true,
                    hir::ExprKind::Await(_) => {
                        self.has_operand_after(raw.pos + 5)
                            && !matches!(self.token_after(raw.pos + 5).1, b"of" | b"using")
                            && Node::Expr(Expr::from_raw(file, i as u32))
                                .enclosing_function()
                                .is_none()
                    }
                    _ => false,
                }
                && file.expr_in_tree(i).is_some()
        })
    }

    /// Whether `at` is in one of the [statements that oxc reads again](super::statements_read_again), with `await` as the
    /// operator. It doesn't get there after an error that it gives up at.
    fn is_read_again(&self, at: u32) -> bool {
        let again = || super::statements_read_again(self.file);
        !self.file.has_parse_errors()
            && (self.read_again.get_or_init(again).iter()).any(|it| it.contains_offset(at))
    }

    /// Whether oxc's parser is in the await context at `node`, which is at `at`.
    fn is_in_async(&self, node: Node<'a>, at: u32) -> bool {
        Self::is_in_async_function(node).unwrap_or_else(|| self.is_module_at(at))
    }

    /// The same. `None`: `node` is in no function, and it depends on what the file is.
    fn is_in_async_function(node: Node<'a>) -> Option<bool> {
        let mut below = node;
        for above in node.ancestors() {
            match above {
                // The head of an arrow function is in the context of what is around, too.
                Node::Func(func) if func.kind() == FnKind::Arrow => {
                    let is_head =
                        matches!(below, Node::Param(_) | Node::Type(_) | Node::TypeParam(_));
                    if func.is_async() || !is_head {
                        return Some(func.is_async());
                    }
                }
                Node::Func(func) if has_own_context(func) => {
                    return Some(func.is_async() || func.kind() == FnKind::StaticBlock);
                }
                Node::Member(member) if member.init().map(Node::Expr) == Some(below) => {
                    return Some(false);
                }
                Node::Stmt(it) if is_read_outside_the_await_context(it) => return Some(false),
                _ => {}
            }
            below = above;
        }
        None
    }

    /// `async await => 1`, at the name. oxc reads what is after `async` as an expression, so in the await context it looks for an
    /// operand and finds the `=>`. A statement in no function is read again that way once the file turns out to be a module.
    /// Returns whether it gives up there.
    fn await_before_arrow(&mut self, func: Func<'a>, at: u32) -> bool {
        let (arrow, token, _) = self.token_after(at + 5);
        let is_keyword = || Self::is_in_async_function(Node::Func(func)).unwrap_or(self.is_module);
        if token != b"=>" || !is_keyword() {
            return false;
        }
        self.settled.push(at);
        let error = SyntaxError::of_oxc(Span::new(arrow, arrow + 2), "Unexpected token");
        self.errors.push(error.stage(Stage::Fatal));
        true
    }

    /// What oxc says about `pattern` where it reads it as a type: an object pattern as a type literal, an array pattern as a
    /// tuple.
    fn pattern_as_type(&self, pattern: Pat<'a>) -> Option<SyntaxError> {
        let semicolon = |after: u32| {
            let message =
                "Expected a semicolon or an implicit semicolon after a statement, but found none";
            SyntaxError::of_oxc(Span::empty(after), message).help("Try inserting a semicolon here")
        };
        let unexpected = |at: u32| self.error(at, b"Unexpected token".to_vec());
        match pattern.kind() {
            ast::PatKind::Object(properties) => properties.iter().find_map(|it| {
                if it.is_rest() {
                    return Some(unexpected(it.span().start));
                }
                let value = it.value();
                let default = || it.default().map(|_| semicolon(value.span().end));
                self.pattern_as_type(value).or_else(default)
            }),
            ast::PatKind::Array(elements) => elements.iter().find_map(|it| {
                let Some(element) = it.pat() else {
                    return Some(unexpected(skip_trivia(self.file.text(), it.span().start)));
                };
                let default = || {
                    it.default()?;
                    let (equals, ..) = self.token_after(element.span().end);
                    let error = self.error(equals, b"Expected `,` or `]` but found `=`".to_vec());
                    let opening = Span::new(pattern.span().start, pattern.span().start + 1);
                    Some(
                        error
                            .says("`,` or `]` expected")
                            .and(opening, "Opened here"),
                    )
                };
                self.pattern_as_type(element).or_else(default)
            }),
            _ => None,
        }
    }

    /// `({ await }: T) => void` where `await` is a keyword, at the name, and the same for `yield`. oxc tells a function type
    /// from a type in parentheses by what follows the `(`. A pattern that it has an error about is none, so it reads a type.
    /// Returns whether it gives up on that.
    fn function_type_as_type(&mut self, func: Func<'a>, at: u32) -> bool {
        let Some(first) = func.params().first().filter(|it| {
            it.pat().span().contains_offset(at)
                && !it.is_rest()
                && func.kind() == FnKind::FunctionType
                && func.type_params().is_empty()
                && func.this_param().is_none()
        }) else {
            return false;
        };
        let pattern = first.pat();
        self.settled.push(at);
        // One of the names in it has been here.
        if self.settled.contains(&pattern.span().start) {
            return true;
        }
        let after_pattern = || {
            let (mut next, mut token, _) = self.token_after(pattern.span().end);
            if token == b"?" {
                (next, token, _) = self.token_after(next + 1);
            }
            let message = [b"Expected `)` but found `", token, b"`"].concat();
            (token != b")").then(|| self.error(next, message).says("`)` expected"))
        };
        let Some(error) = self.pattern_as_type(pattern).or_else(after_pattern) else {
            self.settled.pop();
            return false;
        };
        self.settled.push(pattern.span().start);
        self.errors.push(error.stage(Stage::Fatal));
        true
    }

    /// `check_identifier` of oxc's parser: `await` or `yield` is a name where it is a keyword. The parser goes on.
    fn keyword_in_its_context(&mut self, name: Atom, at: u32) {
        if self.settled.contains(&at) {
            return;
        }
        self.settled.push(at);
        let error = match name == known::r#yield {
            true => {
                let message = b"Cannot use `yield` as an identifier in a generator context";
                let rest = self.file.text().get(at as usize..).unwrap_or_default();
                let error = self.error(at, message.to_vec());
                match self.has_operand_after(at + token_len(rest) as u32) {
                    true => error.help(
                        "Wrap this in parentheses if you want to use a `yield` expression here",
                    ),
                    false => error,
                }
            }
            false => {
                let message = b"Cannot use `await` as an identifier in an async context";
                self.error(at, message.to_vec())
            }
        };
        self.errors.push(error.stage(Stage::Parser));
    }

    /// The local name of an import specifier is any word to oxc's parser, which then looks at what it has got.
    fn reserved_word_in_import(&mut self, name: Atom, at: u32) {
        self.look_at(at);
        self.settled.push(at);
        let word = match name == known::r#yield {
            true => "yield",
            false => "await",
        };
        let message =
            format!("Identifier expected. '{word}' is a reserved word that cannot be used here.");
        let error = self.error(at, message.into_bytes());
        self.errors.push(error.stage(Stage::Parser));
    }

    /// oxc's `parse_let`, for the statements that start at one of `lets`, where the word is a name here.
    fn statements_that_start_with_let(&mut self, lets: &[u32]) {
        let file = self.file;
        for tag in [StmtTag::Expr, StmtTag::Labeled] {
            for it in file.stmts_of_kind(tag) {
                let start = it.span().start;
                if lets.contains(&start) {
                    self.statement_that_starts_with_let(it, start + 3);
                }
            }
        }
    }

    /// At the start of a statement `let` begins a declaration whatever comes next, unless that is an operator between two
    /// operands, a `.`, a `(` or a `;`. `after`: the end of the word.
    fn statement_that_starts_with_let(&mut self, statement: Stmt<'a>, after: u32) {
        let (next, token, is_on_line) = self.token_after(after);
        let goes_on = match token {
            b"=>" | b"++" | b"--" | b"||" | b"&&" | b"??" | b"?" | b"!" | b"..." => false,
            b"in" | b"instanceof" | b"." | b"(" | b";" => true,
            [first, ..] => bun_core::strings::contains_char(b"=+-*/%<>|&^!?", *first),
            [] => false,
        };
        if goes_on {
            return;
        }
        // Where there can be one statement and no declaration, the word is a name, and the statement is over after it.
        let is_alone = matches!(statement.parent(), Node::Stmt(it) if matches!(
            it.kind(),
            StmtKind::If { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::With { .. }
                | StmtKind::Labeled { .. }
        ));
        let error = match is_alone {
            true if !is_on_line || matches!(token, b"" | b"}") => return,
            true => {
                let message = "Expected a semicolon or an implicit semicolon after a statement, but found none";
                SyntaxError::of_oxc(Span::empty(after), message)
                    .help("Try inserting a semicolon here")
            }
            // An escape, however it is written, is part of a name for oxc's lexer, which has reported it.
            false if token.starts_with(b"\\") => return,
            false => {
                let label = Span::new(next, next + token.len() as u32);
                SyntaxError::of_oxc(label, "Unexpected token")
            }
        };
        self.errors.push(error.stage(Stage::Fatal));
    }

    /// `ScopeFlags::is_strict_mode` where the name at `at` is, which is `node` or is in it. The decorators of a class are
    /// outside its scope, the name and the parameters of a function are in the scope of the function. For the note oxc goes up
    /// the tree, where the decorators are in the class.
    fn strictness(&self, node: Node<'a>, at: u32) -> Strict {
        let (mut is_in_class, mut is_in_scope_of_class, mut has_directive) = (false, false, false);
        for it in std::iter::once(node).chain(node.ancestors()) {
            match it {
                Node::Class(class) => {
                    is_in_class = true;
                    is_in_scope_of_class |= class.keyword_span().start <= at;
                }
                Node::Func(func) => {
                    let body = func.body_statements();
                    has_directive |= body.is_some_and(|it| has_use_strict(it.iter()));
                }
                Node::File(file) => has_directive |= has_use_strict(file.body().iter()),
                _ => {}
            }
        }
        if !is_in_scope_of_class && !self.is_module && !has_directive {
            return Strict::No;
        }
        match (is_in_class, self.is_module) {
            (true, _) => Strict::Class,
            (false, true) => Strict::Module,
            (false, false) => Strict::Directive,
        }
    }

    /// It is in a statement that starts with `declare`.
    fn is_ambient(node: Node<'a>) -> bool {
        std::iter::once(node)
            .chain(node.ancestors())
            .any(|it| matches!(it, Node::Stmt(it) if it.flags().contains(Flags::AMBIENT)))
    }

    /// `check_identifier`
    fn identifier(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name == known::eval || name == known::arguments || Self::is_ambient(node) {
            return;
        }
        // The name, however it is spelled: `yi\u0065ld`
        let text = self.file.name(name).bytes();
        let reserved = [b"The keyword '", text, b"' is reserved"].concat();
        let error = if name != known::r#await {
            let note = match self.strictness(node, at) {
                Strict::No => return,
                Strict::Class => "Classes are always strict mode code",
                Strict::Module => "Modules are always strict mode code",
                Strict::Directive => "This identifier is reserved in strict mode code",
            };
            self.error(at, reserved).note(note)
        } else if self.is_module {
            let note = "The identifier `await` is reserved in module code";
            self.error(at, reserved).note(note)
        } else if is_directly_in_static_block(node) {
            let message = b"Cannot use await in class static initialization block";
            self.error(at, message.to_vec())
        } else {
            return;
        };
        self.errors.push(error);
    }

    fn cannot_assign(&mut self, name: Atom, at: u32, why: Strict) {
        let name: &[u8] = match name == known::eval {
            true => b"eval",
            false => b"arguments",
        };
        let message = [b"Cannot assign to '", name, b"' in strict mode"].concat();
        let error = self.error(at, message).note(match why {
            Strict::Class => "Classes are always strict mode code",
            Strict::Module => "Modules are always strict mode code",
            Strict::Directive | Strict::No => "This is strict mode code",
        });
        self.errors.push(error);
    }

    /// `check_binding_identifier`
    fn binding(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name == known::eval || name == known::arguments {
            // As in tsc's binder, what is only declared passes, but for a variable and a name in a pattern.
            let is_variable_or_in_pattern = match node {
                Node::Pat(pat) => match pat.parent() {
                    Node::VarDecl(it) => !is_catch_parameter(it),
                    Node::Param(_) => false,
                    _ => true,
                },
                _ => false,
            };
            let why = self.strictness(node, at);
            if why != Strict::No && (is_variable_or_in_pattern || !Self::is_ambient(node)) {
                self.cannot_assign(name, at, why);
            }
        } else if name == known::let_ && self.strictness(node, at) == Strict::No {
            let declarator = node.ancestors().find_map(|it| match it {
                Node::VarDecl(it) if !is_catch_parameter(it) => Some(Some(it.var_kind())),
                Node::Func(func) if func.kind() != FnKind::Arrow => Some(None),
                _ => None,
            });
            let keyword = match declarator.flatten() {
                None | Some(VarKind::Var) => return,
                Some(VarKind::Let) => "let",
                Some(VarKind::Const) => "const",
                Some(VarKind::Using) => "using",
                Some(VarKind::AwaitUsing) => "await using",
            };
            let message = format!(
                "`let` cannot be declared as a variable name inside of a `{keyword}` declaration"
            );
            let error = self.error(at, message.into_bytes());
            self.errors.push(error);
        }
    }

    /// `check_identifier_reference`
    fn reference(&mut self, name: Atom, at: u32, node: Node<'a>) {
        if name != known::eval && name != known::arguments {
            return;
        }
        if let Node::Expr(it) = node
            && is_assigned_to(it, name)
        {
            match self.strictness(node, at) {
                Strict::No => {}
                why => return self.cannot_assign(name, at, why),
            }
        }
        if name != known::arguments {
            return;
        }
        let mut below = node;
        for above in node.ancestors() {
            let place = match above {
                Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                    "static initialization block"
                }
                Node::Func(func) if func.kind() != FnKind::Arrow => return,
                Node::Member(member)
                    if member.kind() == MemberKind::Property
                        && !member.flags().contains(Flags::ACCESSOR)
                        && member.init().map(Node::Expr) == Some(below) =>
                {
                    "class field initializer"
                }
                _ => {
                    below = above;
                    continue;
                }
            };
            let message = format!("'arguments' is not allowed in {place}");
            let help = "Assign the 'arguments' variable to a temporary variable outside";
            let error = self.error(at, message.into_bytes()).help(help);
            return self.errors.push(error);
        }
    }

    /// `export { static }`, which oxc's parser reports.
    fn exported_without_from(&mut self, spec: &hir::ExportSpec) {
        self.look_at(spec.local_pos);
        let local = self
            .file
            .text()
            .get(spec.local_pos as usize..)
            .unwrap_or_default();
        let local = local.get(..token_len(local)).unwrap_or_default();
        let names = match spec.local_pos == spec.pos {
            true => [local, b" as ", local].concat(),
            false => self
                .file
                .slice(Span::new(spec.local_pos, spec.end))
                .to_vec(),
        };
        let names: String = bstr::ByteSlice::chars(&names[..]).collect();
        let message = b"A reserved word cannot be used as an exported binding without `from`";
        let error = self.error(spec.local_pos, message.to_vec());
        let help = format!("Did you mean `export {{ {names} }} from 'some-module'`?");
        self.errors.push(error.help(help).stage(Stage::Parser));
    }

    fn check(&mut self, role: Role, name: Atom, at: u32, node: Node<'a>) {
        if self.file.is_in_jsdoc(at) {
            return;
        }
        self.look_at(at);
        if self.is_declaration_file {
            return;
        }
        self.identifier(name, at, node);
        match role {
            Role::Binding => self.binding(name, at, node),
            Role::Reference => self.reference(name, at, node),
            Role::Label => {}
        }
    }
}

/// The `e` of `catch (e)` is a declaration here, and none to oxc.
fn is_catch_parameter(it: VarDecl) -> bool {
    matches!(it.parent(), Node::Stmt(it) if matches!(it.kind(), StmtKind::Try { .. }))
}

/// The scope that oxc is in at `node` is that of a static block. The name of a function or a class is in the scope of that, the
/// name of an enum, an interface, a type alias or a namespace is outside.
fn is_directly_in_static_block<'a>(node: Node<'a>) -> bool {
    let is_scope = |it: &Node<'a>| match it {
        Node::Func(_) | Node::Class(_) => true,
        Node::Stmt(it) => match it.kind() {
            StmtKind::Block(_)
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. } => true,
            StmtKind::Enum(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Module(_) => Node::Stmt(*it) != node,
            _ => false,
        },
        Node::Type(it) => matches!(it.kind(), TypeKind::Mapped(_) | TypeKind::Cond { .. }),
        _ => false,
    };
    let scope = std::iter::once(node).chain(node.ancestors()).find(is_scope);
    matches!(scope, Some(Node::Func(func)) if func.kind() == FnKind::StaticBlock)
}

/// Whether oxc's parser sets the await and the yield context anew for `func`, which is no arrow function. Not for what is only
/// a type: a function type, a signature in an interface or in a type literal.
fn has_own_context(func: Func) -> bool {
    match func.kind() {
        FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => false,
        FnKind::Method | FnKind::Getter | FnKind::Setter => !matches!(
            Node::Func(func).parent(),
            Node::Member(it) if !matches!(Node::Member(it).parent(), Node::Class(_))
        ),
        _ => true,
    }
}

/// oxc leaves the await context for a declaration that starts with one of these words. One after `export` or a decorator does
/// not start with it. A type is in the context of what is around it.
fn is_read_outside_the_await_context(it: Stmt) -> bool {
    let text = it.text();
    matches!(
        it.tag(),
        StmtTag::Class
            | StmtTag::Enum
            | StmtTag::Fn
            | StmtTag::Interface
            | StmtTag::Module
            | StmtTag::TypeAlias
            | StmtTag::Var
    ) && matches!(
        text.get(..token_len(text)),
        Some(
            b"abstract"
                | b"declare"
                | b"enum"
                | b"global"
                | b"interface"
                | b"module"
                | b"namespace"
                | b"type"
        )
    )
}

/// Whether oxc's parser is in the yield context at `node`. Unlike the await context, that goes on in types.
fn is_in_generator(node: Node) -> bool {
    let mut below = node;
    for above in node.ancestors() {
        match above {
            // The head of an arrow function is in the context of what is around.
            Node::Func(func)
                if func.kind() == FnKind::Arrow
                    && matches!(below, Node::Param(_) | Node::Type(_) | Node::TypeParam(_)) => {}
            Node::Func(func) if has_own_context(func) => return func.is_generator(),
            Node::Member(member) if member.init().map(Node::Expr) == Some(below) => return false,
            _ => {}
        }
        below = above;
    }
    false
}

/// The function one of whose parameters binds `name`, and whether the name is all of the pattern of the parameter.
fn function_of_parameter<'a>(name: Node<'a>) -> Option<(Func<'a>, bool)> {
    let mut is_all = true;
    for above in name.ancestors() {
        match above {
            Node::Param(_) => {}
            Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) => is_all = false,
            Node::Func(func) => return Some((func, is_all)),
            _ => return None,
        }
    }
    None
}

/// oxc goes up from the name, past functions too, until it meets a member expression: a pattern that is assigned to or a `++`
/// anywhere above counts, and an assignment to the same name.
fn is_assigned_to(it: Expr, name: Atom) -> bool {
    for above in Node::Expr(it).ancestors() {
        let Node::Expr(above) = above else {
            continue;
        };
        match above.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } => return false,
            ExprKind::Array(_) | ExprKind::Object(_) if above.is_assignment_target() => {
                return true;
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                ..
            } => return true,
            // A default in a pattern is no assignment to oxc.
            ExprKind::Assign { target, .. }
                if matches!(target.try_raw().map(|it| it.kind), Some(hir::ExprKind::Ident(it)) if it == name)
                    && !above.is_assignment_target() =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    if hir.keyword_identifier_positions.is_empty() {
        return Vec::new();
    }
    let positions = hir.keyword_identifier_positions.iter();
    let mut positions: SmallVec<[u32; 8]> = positions.copied().collect();
    positions.sort_unstable();
    positions.dedup();
    let noted: SmallVec<[(u32, bool); 8]> = positions.iter().map(|&at| (at, false)).collect();
    let mut checks = Checks {
        file,
        is_module: source_type(file) == SourceType::Module,
        is_declaration_file: file.is_declaration_file(),
        left: noted.len(),
        noted,
        settled: SmallVec::new(),
        read_again: OnceCell::new(),
        errors: Vec::new(),
    };
    let is_keyword = |name: Atom| name.is_keyword_identifier();
    let is_reserved = |name: Atom| name == known::r#await || name == known::r#yield;
    let statement = |id: hir::StmtId| Node::Stmt(Stmt::new(file, id));
    // It is over as soon as all that the parser has noted is found.
    'all: {
        for (i, raw) in hir.exprs.iter().enumerate() {
            if let hir::ExprKind::Ident(name) = raw.kind
                && is_keyword(name)
                && file.expr_in_tree(i).is_some()
            {
                let it = Expr::from_raw(file, i as u32);
                if !it.is_jsx_tag_name() {
                    checks.check(Role::Reference, name, raw.pos, Node::Expr(it));
                    if checks.left == 0 {
                        break 'all;
                    }
                }
            }
        }
        for (i, raw) in hir.pats.iter().enumerate() {
            if let PatKind::Ident(name) = raw.kind
                && is_keyword(name)
                && file.pat_in_tree(i).is_some()
            {
                let node = Node::Pat(Pat::from_raw(file, i as u32));
                // The key of an index signature is no binding to oxc.
                let owner = node.ancestors().nth(1);
                if matches!(owner, Some(Node::Func(it)) if it.kind() == FnKind::IndexSignature) {
                    continue;
                }
                // The parser here reads the head of an arrow function outside the context around it, and knows late that one is
                // async.
                let is_keyword_here = match function_of_parameter(node) {
                    Some((func, false))
                        if !has_own_context(func)
                            && match name == known::r#await {
                                true => checks.is_in_async(Node::Func(func), raw.pos),
                                false => {
                                    name == known::r#yield && is_in_generator(Node::Func(func))
                                }
                            }
                            && checks.function_type_as_type(func, raw.pos) =>
                    {
                        false
                    }
                    Some((func, true))
                        if name == known::r#await
                            && func.kind() == FnKind::Arrow
                            && func.is_async()
                            && checks.await_before_arrow(func, raw.pos) =>
                    {
                        false
                    }
                    Some((func, _)) if name == known::r#await => {
                        func.is_async()
                            || (func.kind() == FnKind::Arrow || !has_own_context(func))
                                && checks.is_in_async(Node::Func(func), raw.pos)
                    }
                    Some((func, is_all)) if name == known::r#yield => {
                        (func.kind() == FnKind::Arrow || is_all && !has_own_context(func))
                            && is_in_generator(Node::Func(func))
                    }
                    _ => false,
                };
                if is_keyword_here {
                    checks.keyword_in_its_context(name, raw.pos);
                }
                checks.check(Role::Binding, name, raw.pos, node);
            }
        }
        if checks.left == 0 {
            break 'all;
        }
        for (i, raw) in hir.fns.iter().enumerate() {
            let func = Func::from_raw(file, i as u32);
            if is_keyword(raw.name)
                && matches!(raw.kind, FnKind::Decl | FnKind::Expr)
                && func.is_in_tree()
            {
                checks.check(Role::Binding, raw.name, raw.name_pos, Node::Func(func));
            }
        }
        for (i, raw) in hir.classes.iter().enumerate() {
            if is_keyword(raw.name) {
                let node = Node::Class(Class::from_raw(file, i as u32));
                checks.check(Role::Binding, raw.name, raw.name_pos, node);
            }
        }
        if checks.left == 0 {
            break 'all;
        }
        for (i, raw) in hir.type_params.iter().enumerate() {
            if is_keyword(raw.name) {
                let node = Node::TypeParam(TypeParam::from_raw(file, i as u32));
                checks.check(Role::Binding, raw.name, raw.pos, node);
            }
        }
        for (i, raw) in hir.types.iter().enumerate() {
            if let TypeNodeKind::Ref { name, .. } = raw.kind
                && let Some(first) = hir.names.get(name.start as usize)
                && is_keyword(first.text)
            {
                let node = Node::Type(TypeNode::from_raw(file, i as u32));
                checks.check(Role::Reference, first.text, first.pos(), node);
            }
        }
        if checks.left == 0 {
            break 'all;
        }
        for raw in hir.imports {
            for (name, at) in [
                (raw.default, raw.default_pos),
                (raw.namespace, raw.namespace_pos),
            ] {
                if is_keyword(name) {
                    checks.check(Role::Binding, name, at, statement(raw.stmt));
                }
            }
            for spec in hir.import_specs.get(raw.named.range()).unwrap_or_default() {
                if is_reserved(spec.local) {
                    checks.reserved_word_in_import(spec.local, spec.pos);
                } else if is_keyword(spec.local) {
                    checks.check(Role::Binding, spec.local, spec.pos, statement(raw.stmt));
                }
            }
        }
        for raw in hir.exports.iter().filter(|it| !it.has_module_specifier) {
            for spec in hir.export_specs.get(raw.items.range()).unwrap_or_default() {
                if spec.local == known::let_ {
                    checks.check(Role::Label, spec.local, spec.local_pos, statement(raw.stmt));
                } else if is_keyword(spec.local)
                    && spec.local != known::eval
                    && spec.local != known::arguments
                {
                    checks.exported_without_from(spec);
                }
            }
        }
        // The parser here leaves the await context of the top level for the whole of `import a = b`.
        for raw in hir.import_equals.iter() {
            if raw.name == known::r#await
                && matches!(statement(raw.stmt).parent(), Node::File(_))
                && checks.is_module_at(raw.name_pos)
            {
                checks.keyword_in_its_context(raw.name, raw.name_pos);
            }
            if let hir::ImportEqualsTarget::Entity(names) = raw.target
                && let Some(first) = hir.names.get(names.start as usize)
                && !names.is_empty()
                && is_keyword(first.text)
            {
                checks.check(
                    Role::Reference,
                    first.text,
                    first.pos(),
                    statement(raw.stmt),
                );
            }
        }
        let named = (hir
            .import_equals
            .iter()
            .map(|it| (it.name, it.name_pos, it.stmt)))
        .chain(hir.aliases.iter().map(|it| (it.name, it.name_pos, it.stmt)))
        .chain(
            hir.interfaces
                .iter()
                .map(|it| (it.name, it.name_pos, it.stmt)),
        )
        .chain(hir.enums.iter().map(|it| (it.name, it.name_pos, it.stmt)))
        .chain(hir.modules.iter().filter_map(|it| match it.name {
            hir::ModuleName::Ident(name) => Some((name, it.name_pos, it.stmt)),
            _ => None,
        }));
        for (name, at, id) in named {
            if is_keyword(name) {
                checks.check(Role::Binding, name, at, statement(id));
            }
        }
        if checks.left == 0 {
            break 'all;
        }
        for (i, raw) in hir.stmts.iter().enumerate() {
            let (label, at) = match raw.kind {
                hir::StmtKind::Labeled { label, .. } => (label, raw.start),
                hir::StmtKind::Break(label) | hir::StmtKind::Continue(label) => {
                    let keyword = file.text().get(raw.start as usize..).unwrap_or_default();
                    let after = raw.start + token_len(keyword) as u32;
                    (label, skip_trivia(file.text(), after))
                }
                _ => continue,
            };
            if label.is_some() && is_keyword(label) {
                checks.check(Role::Label, label, at, statement(hir::StmtId(i as u32)));
            }
        }
    }
    let is_let = |at: &u32| {
        let rest = file.text().get(*at as usize..).unwrap_or_default();
        rest.starts_with(b"let") && token_len(rest) == 3
    };
    let positions = hir.keyword_identifier_positions.iter();
    let lets: SmallVec<[u32; 4]> = positions.copied().filter(is_let).collect();
    if !lets.is_empty() {
        checks.statements_that_start_with_let(&lets);
    }
    // The `a` of `export * as a from "b"` is noted like a name that is declared. To oxc it is any word.
    for it in file.stmts_of_kind(StmtTag::ExportStar) {
        if let StmtKind::ExportStar {
            alias: Some(alias), ..
        } = it.kind()
        {
            checks.settled.push(alias.span().start);
        }
    }
    // What the parser has noted: see `note_keyword_identifier`. 1262 and 1214 are at the top level.
    for it in hir.diagnostics.iter() {
        let is_noted = it.kind == DiagnosticKind::Grammar && matches!(it.code, 1359 | 1262 | 1214);
        if is_noted && (it.code == 1359 || checks.is_module_at(it.start)) {
            let name = match file.text().get(it.start as usize) {
                Some(b'y') => known::r#yield,
                _ => known::r#await,
            };
            checks.keyword_in_its_context(name, it.start);
        }
    }
    checks.errors
}
