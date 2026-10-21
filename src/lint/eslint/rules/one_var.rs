use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ast_utils;
use std::cell::OnceCell;
use std::cmp::Reverse;

/// Enforce variables to be declared either together or separately in functions.
pub struct OneVar {
    separate_requires: bool,
    /// Indexed by [`index`].
    kinds: [KindOptions; 5],
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    Never,
    Consecutive,
}

/// The modes configured for one kind of declaration.
#[derive(Copy, Clone, Default)]
struct KindOptions {
    uninitialized: Option<Mode>,
    initialized: Option<Mode>,
}

const COMBINE_UNINITIALIZED: Message = Message::new(
    "combineUninitialized",
    "Combine this with the previous '{{type}}' statement with uninitialized variables.",
);
const COMBINE_INITIALIZED: Message = Message::new(
    "combineInitialized",
    "Combine this with the previous '{{type}}' statement with initialized variables.",
);
const SPLIT_UNINITIALIZED: Message = Message::new(
    "splitUninitialized",
    "Split uninitialized '{{type}}' declarations into multiple statements.",
);
const SPLIT_INITIALIZED: Message = Message::new(
    "splitInitialized",
    "Split initialized '{{type}}' declarations into multiple statements.",
);
const SPLIT_REQUIRES: Message = Message::new(
    "splitRequires",
    "Split requires to be separated into a single block.",
);
const COMBINE: Message = Message::new(
    "combine",
    "Combine this with the previous '{{type}}' statement.",
);
const SPLIT: Message = Message::new(
    "split",
    "Split '{{type}}' declarations into multiple statements.",
);

/// The option keys, indexed by [`index`].
const KEYS: [&str; 5] = ["var", "let", "const", "using", "awaitUsing"];

fn index(kind: VarKind) -> usize {
    match kind {
        VarKind::Var => 0,
        VarKind::Let => 1,
        VarKind::Const => 2,
        VarKind::Using => 3,
        VarKind::AwaitUsing => 4,
    }
}

/// ESTree's `VariableDeclaration.kind`
fn kind_text(kind: VarKind) -> &'static str {
    match kind {
        VarKind::Var => "var",
        VarKind::Let => "let",
        VarKind::Const => "const",
        VarKind::Using => "using",
        VarKind::AwaitUsing => "await using",
    }
}

impl Mode {
    fn of(value: Option<&str>) -> Option<Mode> {
        match value? {
            "always" => Some(Mode::Always),
            "never" => Some(Mode::Never),
            "consecutive" => Some(Mode::Consecutive),
            _ => None,
        }
    }
}

impl KindOptions {
    fn has(self, mode: Mode) -> bool {
        self.uninitialized == Some(mode) || self.initialized == Some(mode)
    }
}

/// Tracks what a scope has declared so far. Only declarations that have to be combined are recorded.
#[derive(Copy, Clone, Default)]
struct Seen {
    initialized: bool,
    uninitialized: bool,
    required: bool,
}

/// True if ESLint calls `startFunction` for `node`, or with `includes_blocks`, `startFunction` or `startBlock`.
fn is_scope(node: Node<'_>, includes_blocks: bool, is_oxlint: bool) -> bool {
    match node {
        // A function's body block isn't a node here, so one scope replaces ESLint's two. The outer one is always empty.
        Node::File(_) => true,
        Node::Func(func) => func.has_body(),
        Node::Stmt(statement) => match statement.tag() {
            // ESLint doesn't know about namespaces. oxlint treats a namespace as its own scope, even for `var`.
            StmtTag::Module => is_oxlint,
            StmtTag::Block | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf | StmtTag::Switch => includes_blocks,
            _ => false,
        },
        _ => false,
    }
}

/// The function scopes, or the block scopes, that enclose the current statement and have declared something, innermost
/// last.
struct Scopes<'a> {
    includes_blocks: bool,
    is_oxlint: bool,
    enclosing_scopes: AncestorMemo<'a, Node<'a>>,
    /// Each with its [`scope_id`] and its [`statements_span`].
    open: Vec<(u64, Span, [Seen; 5])>,
}

/// Returns an ID that's unique to this scope within the file.
fn scope_id(scope: Node<'_>) -> u64 {
    match scope {
        Node::Func(func) => 1 << 32 | u64::from(func.id().0),
        Node::Stmt(statement) => 2 << 32 | u64::from(statement.id().0),
        _ => 0,
    }
}

/// Returns the span from a scope's first statement to its last.
fn statements_span(scope: Node<'_>) -> Span {
    let body = scope.as_func().and_then(Func::body_statements);
    match body.and_then(|it| it.first().zip(it.last())) {
        Some((first, last)) => first.span().to(last.span()),
        None => scope.span(),
    }
}

impl<'a> Scopes<'a> {
    fn new(includes_blocks: bool, is_oxlint: bool) -> Self {
        Scopes {
            includes_blocks,
            is_oxlint,
            enclosing_scopes: AncestorMemo::default(),
            open: Vec::new(),
        }
    }

    /// Returns what `statement`'s scope has declared so far, indexed by [`index`]. Statements have to come in order of
    /// their ends, so each comes after the statements nested in it.
    fn seen(&mut self, statement: Stmt<'a>) -> Option<&mut [Seen; 5]> {
        let (includes_blocks, is_oxlint) = (self.includes_blocks, self.is_oxlint);
        // The scope is nearly always the statement's parent.
        let parent = statement.parent();
        let scope = match is_scope(parent, includes_blocks, is_oxlint) {
            true => parent,
            false => self.enclosing_scopes.find(parent, |_, it| is_scope(it, includes_blocks, is_oxlint).then_some(it))?,
        };
        let number = scope_id(scope);
        if self.open.last().is_none_or(|it| it.0 != number) {
            // Pop the scopes that end before the statement, and the ones nested in it.
            let start = statement.span().start;
            while self.open.last().is_some_and(|it| it.1.end <= start || it.1.start > start) {
                self.open.pop();
            }
            if self.open.last().is_none_or(|it| it.0 != number) {
                self.open.push((number, statements_span(scope), Default::default()));
            }
        }
        self.open.last_mut().map(|it| &mut it.2)
    }
}

/// Counts over a list of declarators.
#[derive(Copy, Clone)]
struct Counts {
    total: usize,
    initialized: usize,
    uninitialized: usize,
    requires: usize,
}

impl Counts {
    /// `mentions_require` is false if none of them can be a `require`.
    fn of<'a>(declarations: List<'a, VarDecl<'a>>, mentions_require: bool) -> Counts {
        let mut counts = Counts {
            total: 0,
            initialized: 0,
            uninitialized: 0,
            requires: 0,
        };
        for declaration in declarations {
            counts.total += 1;
            match declaration.init() {
                None => counts.uninitialized += 1,
                Some(_) => counts.initialized += 1,
            }
            counts.requires += usize::from(mentions_require && is_require(declaration));
        }
        counts
    }
}

/// ESLint's `isRequire`
fn is_require(declaration: VarDecl<'_>) -> bool {
    declaration.init().and_then(Expr::as_call).is_some_and(|call| {
        // An optional call is in a `ChainExpression`.
        call.chain() == Chain::No && call.callee().is_ident("require")
    })
}

/// Returns the declarators and the kind of a `VariableDeclaration`.
fn as_variable_declaration(statement: Stmt<'_>) -> Option<(List<'_, VarDecl<'_>>, VarKind)> {
    let declarations = statement.as_var()?;
    Some((declarations, declarations.first()?.var_kind()))
}

/// Returns the element before `statement` in `statement.parent.body`, if that's a list.
fn previous_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    // Its parent is an `ExportNamedDeclaration`.
    if statement.is_exported() {
        return None;
    }
    body_of(statement.parent())?.before(statement.span().start)
}

/// Returns `parent.body`, if that's a list of statements.
pub(super) fn body_of(parent: Node<'_>) -> Option<List<'_, Stmt<'_>>> {
    match parent {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => parent.as_block().or_else(|| Some(parent.as_module()?.body())),
        _ => None,
    }
}

/// Returns the `VariableDeclaration` of the same kind right before `statement`.
fn previous_declaration(statement: Stmt<'_>, kind: VarKind) -> Option<(Stmt<'_>, List<'_, VarDecl<'_>>)> {
    let previous = previous_statement(statement).filter(|it| !it.is_exported())?;
    let (declarations, previous_kind) = as_variable_declaration(previous)?;
    (previous_kind == kind).then_some((previous, declarations))
}

/// True if `statement` is the `init` of a `for`.
fn is_for_init(statement: Stmt<'_>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::For { init, .. } if init == Some(statement)))
}

/// True if `statement` is the `left` of a `for`-`in` or a `for`-`of`.
fn is_for_left(statement: Stmt<'_>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == statement))
}

/// Returns the statement that [`join_declarations`] joins `statement` with.
fn joined_with(statement: Stmt<'_>, kind: VarKind) -> Option<Stmt<'_>> {
    // Declarations with `declare` are never joined, as in oxlint. ESLint's fix mistakes `declare` for the keyword and
    // breaks the code.
    let (previous, _) = previous_declaration(statement, kind)?;
    (statement.modifiers().is_empty() && previous.modifiers().is_empty()).then_some(previous)
}

/// oxlint's `help` is the name of its fix.
fn name_of_fix(name: &str, is_fixed: bool) -> String {
    if is_fixed { name.to_owned() } else { String::new() }
}

/// ESLint's `joinDeclarations`: replaces the `;` of `previous` with a `,`, or adds one after it, and removes the
/// keyword.
fn join_declarations<'a>(fixer: Fixer<'a>, statement: Stmt<'a>, previous: Stmt<'a>, kind: VarKind) -> Fix {
    let file = fixer.file();
    let (start, word) = (statement.span().start, if kind == VarKind::AwaitUsing { "await" } else { kind_text(kind) });
    let first = Span::new(start, start + word.len() as u32);
    let mut text = b",".to_vec();
    text.extend_from_slice(file.slice(previous.span().between(first)));
    let mut last = first;
    if kind == VarKind::AwaitUsing {
        let using = skip_trivia(file.text(), first.end);
        text.extend_from_slice(file.slice(Span::after(first, using)));
        last = Span::new(using, using + "using".len() as u32);
    }
    let start = previous.semicolon().map_or_else(|| previous.span().end, |it| it.start);
    fixer.replace(Span::new(start, last.end), text)
}

/// ESLint's `splitDeclarations`
fn split_declarations<'a>(
    fixer: Fixer<'a>,
    statement: Stmt<'a>,
    declarations: List<'a, VarDecl<'a>>,
    kind: VarKind,
) -> Option<Vec<Fix>> {
    if !ast_utils::is_statement_list_parent(statement.parent()) {
        return None;
    }
    let file = fixer.file();
    let export_placement = if statement.is_exported() { "export " } else { "" };
    // ESLint drops the `declare`, which turns the remaining declarations into real variables.
    let declare = if statement.flags().contains(Flags::AMBIENT) { "declare " } else { "" };
    let kind = format!("{declare}{}", kind_text(kind));
    let mut fixes = Vec::new();
    for declaration in declarations {
        let Some(comma) = file.token_after(declaration).filter(|it| it.is(",")) else {
            continue;
        };
        let (Some(after_comma), Some(next_token)) = (
            file.tokens_after(comma).with_comments().next(),
            file.token_after(comma),
        ) else {
            continue;
        };
        fixes.push(if after_comma.start() == comma.end() {
            fixer.replace(comma, format!("; {export_placement}{kind} "))
        } else if after_comma.is_comment()
            || file.line_of(after_comma.start()) > file.line_of(comma.end())
        {
            let mut text = b";".to_vec();
            text.extend_from_slice(file.slice(comma.span().between(next_token.span())));
            text.extend_from_slice(export_placement.as_bytes());
            text.extend_from_slice(kind.as_bytes());
            text.push(b' ');
            fixer.replace(Span::new(comma.start(), next_token.start()), text)
        } else {
            fixer.replace(comma, format!("; {export_placement}{kind}"))
        });
    }
    Some(fixes)
}

fn report_combine<'a>(cx: &Cx<'a, OneVar>, statement: Stmt<'a>, kind: VarKind, message: Message) {
    let previous = OnceCell::new();
    let previous = || *previous.get_or_init(|| joined_with(statement, kind));
    cx.report(statement.span_without_export(), message)
        .data("type", kind_text(kind))
        // oxlint's `help` is the name of its fix.
        .labels_with(|details| details.help = if previous().is_some() { "Combine variable declarations" } else { "" }.into())
        .fix(|fixer| Some(join_declarations(fixer, statement, previous()?, kind)));
}

impl OneVar {
    /// ESLint's `hasOnlyOneStatement`, which includes `recordTypes`.
    fn has_only_one_statement(&self, kind: VarKind, counts: Counts, scope: &mut Seen) -> bool {
        let options = self.kinds[index(kind)];
        let always_uninitialized = options.uninitialized == Some(Mode::Always);
        let always_initialized = options.initialized == Some(Mode::Always);
        // Nothing is ever recorded.
        if !always_uninitialized && !always_initialized {
            return true;
        }
        let has_requires = counts.requires > 0;
        if always_uninitialized
            && always_initialized
            && (scope.uninitialized || scope.initialized)
            && !has_requires
        {
            return false;
        }
        if counts.uninitialized > 0 && always_uninitialized && scope.uninitialized {
            return false;
        }
        if counts.initialized > 0 && always_initialized && scope.initialized && !has_requires {
            return false;
        }
        if scope.required && has_requires {
            return false;
        }
        scope.uninitialized |= always_uninitialized && counts.uninitialized > 0;
        if always_initialized {
            let separate_count = if self.separate_requires { counts.requires } else { 0 };
            scope.required |= separate_count > 0;
            scope.initialized |= counts.initialized > separate_count;
        }
        true
    }

    /// ESLint's `checkVariableDeclaration`. `seen` is what `statement`'s scope has declared so far with the same
    /// `kind`.
    fn check_variable_declaration<'a>(
        &self,
        statement: Stmt<'a>,
        (declarations, kind): (List<'a, VarDecl<'a>>, VarKind),
        seen: &mut Seen,
        cx: &Cx<'a, Self>,
    ) {
        let options = self.kinds[index(kind)];
        let (always, never, consecutive) =
            (Some(Mode::Always), Some(Mode::Never), Some(Mode::Consecutive));
        if options.initialized.is_none() && options.uninitialized.is_none() {
            return;
        }
        let counts = Counts::of(declarations, cx.state);

        if options.initialized == always
            && self.separate_requires
            && counts.requires > 0
            && counts.requires < counts.total
        {
            cx.report(statement.span_without_export(), SPLIT_REQUIRES);
        }

        if options.has(Mode::Consecutive)
            && let Some((_, previous)) = previous_declaration(statement, kind)
        {
            let previous = Counts::of(previous, cx.state);
            let requires = counts.requires + previous.requires;
            let are_requires_mixed = requires > 0 && requires < counts.total + previous.total;
            let message = if are_requires_mixed {
                None
            } else if options.initialized == consecutive && options.uninitialized == consecutive {
                Some(COMBINE)
            } else if options.initialized == consecutive
                && counts.initialized > 0
                && previous.initialized > 0
            {
                Some(COMBINE_INITIALIZED)
            } else if options.uninitialized == consecutive
                && counts.uninitialized > 0
                && previous.uninitialized > 0
            {
                Some(COMBINE_UNINITIALIZED)
            } else {
                None
            };
            if let Some(message) = message {
                report_combine(cx, statement, kind, message);
            }
        }

        if !self.has_only_one_statement(kind, counts, seen) {
            if options.initialized == always && options.uninitialized == always {
                report_combine(cx, statement, kind, COMBINE);
            } else {
                if options.initialized == always && counts.initialized > 0 {
                    report_combine(cx, statement, kind, COMBINE_INITIALIZED);
                }
                if options.uninitialized == always && counts.uninitialized > 0 {
                    if is_for_left(statement) {
                        return;
                    }
                    report_combine(cx, statement, kind, COMBINE_UNINITIALIZED);
                }
            }
        }

        if counts.total > 1 && options.has(Mode::Never) && !is_for_init(statement) {
            let message = if options.initialized == never && options.uninitialized == never {
                SPLIT
            } else if options.initialized == never && counts.initialized > 0 {
                SPLIT_INITIALIZED
            } else if options.uninitialized == never && counts.uninitialized > 0 {
                SPLIT_UNINITIALIZED
            } else {
                return;
            };
            let mut report = cx.report(statement.span_without_export(), message).data("type", kind_text(kind));
            if cx.language().is_oxlint {
                let is_fixed = || ast_utils::is_statement_list_parent(statement.parent());
                report = report.help_with(|| name_of_fix("Split variable declarations", is_fixed()));
            }
            report.fix(|fixer| split_declarations(fixer, statement, declarations, kind));
        }
    }
}

impl Rule for OneVar {
    const META: Meta = Meta::eslint("one-var", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().stmts(&[StmtTag::Var]).finish();
    /// True if the file mentions `require`.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mut kinds = [KindOptions::default(); 5];
        if options.get(0).is_some_and(|it| it.as_object().is_some()) {
            let shared_mode = |key: &str| object.has(key).then(|| Mode::of(object.str(key)));
            for (kind, key) in kinds.iter_mut().zip(KEYS) {
                let mode = Mode::of(object.str(key));
                *kind = KindOptions {
                    uninitialized: shared_mode("uninitialized").unwrap_or(mode),
                    initialized: shared_mode("initialized").unwrap_or(mode),
                };
            }
        } else {
            let mode = Mode::of(options.str(0)).or(Some(Mode::Always));
            kinds = [KindOptions {
                uninitialized: mode,
                initialized: mode,
            }; 5];
        }
        OneVar {
            separate_requires: object.bool_or("separateRequires", false),
            kinds,
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        // Only `"always"` depends on earlier declarations.
        match self.kinds.iter().any(|it| it.has(Mode::Always)) {
            true => On::new().finish(),
            false => On::new().stmts(&[StmtTag::Var]),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        file.has_stmts([StmtTag::Var]).then(|| file.mentions("require"))
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(declaration) = as_variable_declaration(statement) {
            self.check_variable_declaration(statement, declaration, &mut Seen::default(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let (mut functions, mut blocks) = (Scopes::new(false, is_oxlint), Scopes::new(true, is_oxlint));
        let mut check = |statement| {
            let Some(declaration) = as_variable_declaration(statement) else {
                return;
            };
            let scopes = if declaration.1 == VarKind::Var { &mut functions } else { &mut blocks };
            if let Some(seen) = scopes.seen(statement) {
                self.check_variable_declaration(statement, declaration, &mut seen[index(declaration.1)], cx);
            }
        };
        // In order of their ends, which is usually how the parser stores them.
        let all = || cx.file().stmts_of_kind(StmtTag::Var);
        if all().map(|it| it.span().end).is_sorted_by(|a, b| a < b) {
            return all().for_each(check);
        }
        let mut sorted: Vec<Stmt> = all().collect();
        utils::sort::sort_unstable_by_key(&mut sorted, |it| (it.span().end, Reverse(it.span().start)));
        sorted.into_iter().for_each(&mut check);
    }
}
