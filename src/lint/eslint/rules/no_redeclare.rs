use bun_lint::prelude::*;

/// Disallow variable redeclaration.
pub struct NoRedeclare {
    config: Config,
}

const REDECLARED: Message = Message::new("redeclared", "'{{id}}' is already defined.");
const REDECLARED_AS_BUILTIN: Message = Message::new(
    "redeclaredAsBuiltin",
    "'{{id}}' is already defined as a built-in global variable.",
);
const REDECLARED_BY_SYNTAX: Message = Message::new(
    "redeclaredBySyntax",
    "'{{id}}' is already defined by a variable declaration.",
);

/// The options, shared by ESLint's rule and typescript-eslint's.
#[derive(Copy, Clone)]
pub struct Config {
    pub builtin_globals: bool,
    /// `None` for ESLint's rule. For typescript-eslint's, its option `ignoreDeclarationMerge`.
    pub ignore_declaration_merge: Option<bool>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DeclarationType {
    Builtin,
    Syntax,
    Comment,
}

/// The declaration kinds that decide whether TypeScript merges declarations.
#[derive(Copy, Clone, PartialEq, Eq)]
enum MergeKind {
    Class,
    Interface,
    Module,
    Function,
    Enum,
    Other,
}

fn merge_kind(declaration: Declaration) -> MergeKind {
    match declaration {
        Declaration::Class(class) if matches!(class.owner(), Node::Stmt(_)) => MergeKind::Class,
        Declaration::Interface(_) => MergeKind::Interface,
        Declaration::Module(_) => MergeKind::Module,
        Declaration::Fn(func) if func.kind() == FnKind::Decl => MergeKind::Function,
        Declaration::Enum(_) => MergeKind::Enum,
        _ => MergeKind::Other,
    }
}

/// The range of ESLint's `Identifier` for the name. oxlint's range excludes the type annotation.
fn identifier_span(declaration: Declaration) -> Option<Span> {
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) if !pat.file().language().is_oxlint => {
            Some(utils::estree_span(Node::Pat(pat)))
        }
        _ => declaration.name_span(),
    }
}

/// True if the rule checks `scope`: file, function, block, loop and `switch` scopes. ESLint's rule also checks static
/// block scopes.
fn is_checked(scope: Scope, config: Config) -> bool {
    match scope.kind() {
        ScopeKind::Global | ScopeKind::Module | ScopeKind::Block | ScopeKind::For | ScopeKind::Switch => true,
        ScopeKind::Function => match scope.node() {
            Node::Func(func) => func.has_body(),
            _ => true,
        },
        ScopeKind::ClassStaticBlock => config.ignore_declaration_merge.is_none(),
        _ => false,
    }
}

fn add_identifiers<'a>(config: Config, symbol: Symbol<'a>, into: &mut Vec<(DeclarationType, Span)>) {
    // oxlint treats declarations that TypeScript merges like any others, in source order.
    let is_oxlint = symbol.file().language().is_oxlint;
    // oxlint also reports the overloads of a function that redeclares a global.
    let redeclares_global = is_oxlint && into.first().is_some_and(|it| it.0 == DeclarationType::Builtin);
    let mut add = |declarations: &mut dyn Iterator<Item = Declaration<'a>>| {
        let known = into.len();
        into.extend(declarations.filter_map(identifier_span).map(|span| (DeclarationType::Syntax, span)));
        if is_oxlint && let Some(added) = into.get_mut(known..) {
            utils::sort::sort_unstable_by_key(added, |it| it.1.start);
        }
    };
    let Some(ignore_declaration_merge) = config.ignore_declaration_merge.filter(|_| !redeclares_global) else {
        add(&mut symbol.declarations());
        return;
    };
    // A function declaration without a body is an overload.
    let identifiers =
        || symbol.declarations().filter(|it| !matches!(it, Declaration::Fn(func) if !func.has_body()));
    let kinds = || identifiers().map(merge_kind);
    if ignore_declaration_merge && !is_oxlint && kinds().count() > 1 {
        if kinds().all(|it| it == MergeKind::Interface) || kinds().all(|it| it == MergeKind::Module) {
            return;
        }
        for (main, merges_with_interfaces) in
            [(MergeKind::Class, true), (MergeKind::Function, false), (MergeKind::Enum, false)]
        {
            let merges = |it: MergeKind| {
                it == main || it == MergeKind::Module || merges_with_interfaces && it == MergeKind::Interface
            };
            if kinds().all(merges) {
                // Exactly one `main` declaration merges safely.
                if kinds().filter(|it| *it == main).count() != 1 {
                    add(&mut identifiers().filter(|it| merge_kind(*it) == main));
                }
                return;
            }
        }
    }
    add(&mut identifiers());
}

fn report<'a, R: Rule>(cx: &Cx<'a, R>, name: &'a [u8], declarations: &[(DeclarationType, Span)]) {
    let Some((&(first, first_span), extra_declarations)) = declarations.split_first() else {
        return;
    };
    let detail = match first {
        DeclarationType::Builtin => REDECLARED_AS_BUILTIN,
        _ => REDECLARED_BY_SYNTAX,
    };
    let is_oxlint = cx.language().is_oxlint;
    // oxlint points at the previous declaration, except when a global is redeclared.
    let is_before = is_oxlint && first != DeclarationType::Builtin;
    for (&(_, previous), &(declaration_type, span)) in declarations.iter().zip(extra_declarations) {
        let message = if declaration_type == first { REDECLARED } else { detail };
        let report = cx.report(if is_before { previous } else { span }, message).data("id", name).hint_with(|| {
            let line = cx.line_of(first_span.start);
            (first != DeclarationType::Builtin).then(|| format!("It is first declared on line {line}."))
        });
        report.labels_with(|labels| {
            if is_before {
                labels.first(format!("'{}' is already defined.", bstr::BStr::new(name)));
                labels.push(span, "It can not be redeclared here.");
            }
        });
    }
}

/// For [`Rule::start`]: true if a single declaration can redeclare a global variable.
pub fn can_redeclare_globals<'a>(config: Config, file: &'a File<'a>) -> bool {
    match file.language().is_oxlint {
        // For oxlint, outside a module, anything named like a global redeclares it, in any scope.
        true => config.builtin_globals && utils::oxlint::source_type(file) != SourceType::Module,
        false => file.scope().symbols().len() != 0,
    }
}

/// For [`Rule::symbol`]. The state is the result of [`can_redeclare_globals`].
#[inline]
pub fn check_symbol<'a, R: Rule<State<'a> = bool>>(config: Config, symbol: Symbol<'a>, cx: &Cx<'a, R>) {
    if symbol.declaration_count() > 1 || cx.state {
        check_declarations(config, symbol, cx);
    }
}

fn check_declarations<'a, R: Rule<State<'a> = bool>>(config: Config, symbol: Symbol<'a>, cx: &Cx<'a, R>) {
    let count = symbol.declaration_count();
    let is_oxlint = cx.language().is_oxlint;
    let scope = symbol.scope();
    let is_global = scope.kind() == ScopeKind::Global;
    // oxlint checks every scope.
    if !is_oxlint && (count < 2 && !is_global || !is_checked(scope, config)) {
        return;
    }
    // With `globalReturn`, a module has two file-wide scopes under the global one: a function scope and, inside it, the
    // module scope. Both rules check only the function scope.
    if !is_oxlint && scope.kind() == ScopeKind::Module && cx.language().global_return {
        return;
    }
    let name = symbol.name().bytes();
    let global = match is_oxlint {
        true if cx.state => {
            // Globals that an `env` defines don't count.
            let counts_as_global = ast_utils::is_builtin_global_of_oxlint(name) || cx.language().is_enabled_own_global(name);
            if counts_as_global { cx.file().global(name) } else { None }
        }
        true => None,
        // In a script, a top-level declaration and a configured global with the same name are the same variable.
        false if is_global => cx.file().global(name),
        false => None,
    };
    if count < 2 && global.is_none() {
        return;
    }
    let mut declarations = Vec::new();
    let is_builtin = matches!(global, Some(it) if matches!(it.implicit_setting, Some(Global::Readonly | Global::Writable)));
    if config.builtin_globals && is_builtin {
        declarations.push((DeclarationType::Builtin, Span::default()));
    }
    let comments = global.map_or(&[][..], |it| it.comments);
    let comments = comments.iter().map(|&it| (DeclarationType::Comment, cx.name_in_global_comment(it, name)));
    if config.ignore_declaration_merge.is_some() {
        declarations.extend(comments);
        add_identifiers(config, symbol, &mut declarations);
    } else {
        add_identifiers(config, symbol, &mut declarations);
        declarations.extend(comments);
    }
    report(cx, name, &declarations);
}

/// For [`Rule::finish`]: checks the variables that `/* global */` comments define and the file doesn't declare.
pub fn check_globals_in_comments<'a, R: Rule>(config: Config, cx: &Cx<'a, R>) {
    let file = cx.file();
    for it in file.globals_in_comments() {
        let name = &it.name[..];
        let Some(global) = file.global(name) else {
            continue;
        };
        let is_builtin = config.builtin_globals
            && matches!(global.implicit_setting, Some(Global::Readonly | Global::Writable));
        if global.comments.len() + usize::from(is_builtin) < 2 || file.scope().get_bytes(name).is_some() {
            continue;
        }
        let mut declarations = Vec::new();
        if is_builtin {
            declarations.push((DeclarationType::Builtin, Span::default()));
        }
        let comments = global.comments.iter();
        declarations.extend(comments.map(|&it| (DeclarationType::Comment, file.name_in_global_comment(it, name))));
        report(cx, name, &declarations);
    }
}

impl Rule for NoRedeclare {
    const META: Meta = Meta::eslint("no-redeclare", Kind::Suggestion).recommended().hints();
    const ON: On = On::new().symbols().finish();
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        NoRedeclare {
            config: Config {
                builtin_globals: options.object(0).bool_or("builtinGlobals", true),
                ignore_declaration_merge: None,
            },
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        Some(can_redeclare_globals(self.config, file))
    }

    fn symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        check_symbol(self.config, symbol, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        check_globals_in_comments(self.config, cx);
    }
}
