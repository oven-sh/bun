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

/// The options, and which of the two rules it is.
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

/// What TypeScript merges declarations by.
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

/// The range of the `Identifier` that ESLint has for the name.
fn identifier_span(declaration: Declaration) -> Option<Span> {
    match declaration {
        Declaration::Var(pat) | Declaration::Param(pat) => Some(utils::estree_span(Node::Pat(pat))),
        _ => declaration.name_span(),
    }
}

/// Whether the rule looks at `scope`: the scopes of the file, of functions, blocks, loops and
/// `switch` statements. ESLint's rule also looks at those of static blocks.
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
    // For oxlint the declarations that TypeScript merges are declarations like the others, in the order of the source.
    let is_oxlint = symbol.file().language().is_oxlint;
    let mut add = |declarations: &mut dyn Iterator<Item = Declaration<'a>>| {
        let known = into.len();
        into.extend(declarations.filter_map(identifier_span).map(|span| (DeclarationType::Syntax, span)));
        if is_oxlint && let Some(added) = into.get_mut(known..) {
            added.sort_unstable_by_key(|it| it.1.start);
        }
    };
    let Some(ignore_declaration_merge) = config.ignore_declaration_merge else {
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
                // One is a safe declaration merging.
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
    let Some((&(first, _), extra_declarations)) = declarations.split_first() else {
        return;
    };
    let detail = match first {
        DeclarationType::Builtin => REDECLARED_AS_BUILTIN,
        _ => REDECLARED_BY_SYNTAX,
    };
    let is_oxlint = cx.language().is_oxlint;
    for (&(previous_type, previous), &(declaration_type, span)) in declarations.iter().zip(extra_declarations) {
        let message = if declaration_type == first { REDECLARED } else { detail };
        // oxlint points at the declaration before.
        let is_before = is_oxlint && previous_type != DeclarationType::Builtin;
        cx.report(if is_before { previous } else { span }, message).data("id", name);
    }
}

/// For [`Listeners::symbols`].
pub fn check_symbol<'a, R: Rule>(config: Config, symbol: Symbol<'a>, cx: &Cx<'a, R>) {
    let count = symbol.declaration_count();
    let scope = symbol.scope();
    let is_global = scope.kind() == ScopeKind::Global;
    // oxlint looks at all scopes.
    if count < 2 && !is_global || !cx.language().is_oxlint && !is_checked(scope, config) {
        return;
    }
    let name = symbol.name().bytes();
    // In a script, what the file declares at the top level and what is defined otherwise are the
    // same variable.
    let global = if is_global { cx.file().global(name) } else { None };
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

/// For [`Listeners::finish`]: the variables that `/* global */` comments define and the file does
/// not declare.
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
    const META: Meta = Meta::eslint("no-redeclare", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRedeclare {
            config: Config {
                builtin_globals: options.object(0).bool_or("builtinGlobals", true),
                ignore_declaration_merge: None,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.symbols(|rule, symbol, cx| check_symbol(rule.config, symbol, cx));
        on.finish(|rule, cx| check_globals_in_comments(rule.config, cx));
    }
}
