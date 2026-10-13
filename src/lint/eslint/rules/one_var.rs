use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ast_utils;
use std::cell::OnceCell;
use std::cmp::Reverse;

/// Enforce variables to be declared either together or separately in functions.
pub struct OneVar {
    separate_requires: bool,
    /// By [`index`].
    kinds: [KindOptions; 5],
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Always,
    Never,
    Consecutive,
}

/// What is asked of the declarations of one kind.
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

/// The keys of the options, by [`index`].
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

/// What has been declared in a scope, as far as it has to be declared together.
#[derive(Copy, Clone, Default)]
struct Seen {
    initialized: bool,
    uninitialized: bool,
    required: bool,
}

/// Whether ESLint's `startFunction` is called for `node`, or with `of_blocks` its `startBlock` as well.
fn is_scope(node: Node<'_>, of_blocks: bool, is_oxlint: bool) -> bool {
    match node {
        // The block that is the body of a function is not a node: one scope stands for ESLint's
        // two, of which the outer is empty.
        Node::File(_) => true,
        Node::Func(func) => func.has_body(),
        Node::Stmt(statement) => match statement.tag() {
            // ESLint does not know namespaces. For oxlint what is declared in one is apart, `var` too.
            StmtTag::Module => is_oxlint,
            StmtTag::Block | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf | StmtTag::Switch => of_blocks,
            _ => false,
        },
        _ => false,
    }
}

/// The scopes of one sort, those of functions or those of blocks, around the current statement in which something has been
/// declared, the innermost last.
struct Scopes<'a> {
    of_blocks: bool,
    is_oxlint: bool,
    around: AncestorMemo<'a, Node<'a>>,
    /// Each with its [`number_of`] and its [`extent_of`].
    open: Vec<(u64, Span, [Seen; 5])>,
}

/// It tells a scope from the others of the file.
fn number_of(scope: Node<'_>) -> u64 {
    match scope {
        Node::Func(func) => 1 << 32 | u64::from(func.id().0),
        Node::Stmt(statement) => 2 << 32 | u64::from(statement.id().0),
        _ => 0,
    }
}

/// From where to where there are statements in a scope.
fn extent_of(scope: Node<'_>) -> Span {
    let body = scope.as_func().and_then(Func::body_statements);
    match body.and_then(|it| it.first().zip(it.last())) {
        Some((first, last)) => first.span().to(last.span()),
        None => scope.span(),
    }
}

impl<'a> Scopes<'a> {
    fn new(of_blocks: bool, is_oxlint: bool) -> Self {
        Scopes {
            of_blocks,
            is_oxlint,
            around: AncestorMemo::default(),
            open: Vec::new(),
        }
    }

    /// What has been declared in the scope of `statement`, by [`index`]. The statements come as they end: after what is in them.
    fn seen(&mut self, statement: Stmt<'a>) -> Option<&mut [Seen; 5]> {
        let (of_blocks, is_oxlint) = (self.of_blocks, self.is_oxlint);
        // Nearly always it is what the statement is directly in.
        let parent = statement.parent();
        let scope = match is_scope(parent, of_blocks, is_oxlint) {
            true => parent,
            false => self.around.find(parent, |_, it| is_scope(it, of_blocks, is_oxlint).then_some(it))?,
        };
        let number = number_of(scope);
        if self.open.last().is_none_or(|it| it.0 != number) {
            // What ends before the statement, and what is in it.
            let start = statement.span().start;
            while self.open.last().is_some_and(|it| it.1.end <= start || it.1.start > start) {
                self.open.pop();
            }
            if self.open.last().is_none_or(|it| it.0 != number) {
                self.open.push((number, extent_of(scope), Default::default()));
            }
        }
        self.open.last_mut().map(|it| &mut it.2)
    }
}

/// How many of some declarations have what.
#[derive(Copy, Clone)]
struct Counts {
    total: usize,
    initialized: usize,
    uninitialized: usize,
    requires: usize,
}

impl Counts {
    /// `mentions_require`: whether one can be a `require`.
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

/// The declarations and the kind of a `VariableDeclaration`.
fn as_variable_declaration(statement: Stmt<'_>) -> Option<(List<'_, VarDecl<'_>>, VarKind)> {
    let declarations = statement.as_var()?;
    Some((declarations, declarations.first()?.var_kind()))
}

/// The element before `statement` in `statement.parent.body`, if that is a list.
fn previous_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    // Its parent is an `ExportNamedDeclaration`.
    if statement.is_exported() {
        return None;
    }
    body_of(statement.parent())?.before(statement.span().start)
}

/// `parent.body`, if that is a list of statements.
pub(super) fn body_of(parent: Node<'_>) -> Option<List<'_, Stmt<'_>>> {
    match parent {
        Node::File(file) => Some(file.body()),
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => parent.as_block().or_else(|| Some(parent.as_module()?.body())),
        _ => None,
    }
}

/// The `VariableDeclaration` of the same kind right before `statement`.
fn previous_declaration(statement: Stmt<'_>, kind: VarKind) -> Option<(Stmt<'_>, List<'_, VarDecl<'_>>)> {
    let previous = previous_statement(statement).filter(|it| !it.is_exported())?;
    let (declarations, previous_kind) = as_variable_declaration(previous)?;
    (previous_kind == kind).then_some((previous, declarations))
}

/// `statement` is the `init` of a `for`.
fn is_for_init(statement: Stmt<'_>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::For { init, .. } if init == Some(statement)))
}

/// `statement` is the `left` of a `for`-`in` or a `for`-`of`.
fn is_for_left(statement: Stmt<'_>) -> bool {
    matches!(statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == statement))
}

/// What [`join_declarations`] joins `statement` with.
fn joined_with(statement: Stmt<'_>, kind: VarKind) -> Option<Stmt<'_>> {
    // oxlint joins nothing with a `declare`, and nothing that is exported.
    let is_ambient = |it: Stmt| it.flags().contains(Flags::AMBIENT);
    let (previous, _) = previous_declaration(statement, kind)?;
    let is_left = statement.file().language().is_oxlint && (is_ambient(statement) || is_ambient(previous));
    (!is_left).then_some(previous)
}

/// oxlint's `help` is what it calls its fix.
fn name_of_fix(name: &str, is_fixed: bool) -> String {
    if is_fixed { name.to_owned() } else { String::new() }
}

/// ESLint's `joinDeclarations`: a `,` in the place of the `;` of `previous`, or after it, and no keyword.
fn join_declarations<'a>(fixer: Fixer<'a>, statement: Stmt<'a>, previous: Stmt<'a>, kind: VarKind) -> Option<Fix> {
    let file = fixer.file();
    let first = match statement.modifiers().is_empty() {
        true => {
            let (start, word) = (statement.span().start, if kind == VarKind::AwaitUsing { "await" } else { kind_text(kind) });
            Span::new(start, start + word.len() as u32)
        }
        false => file.first_token(statement)?.span(),
    };
    let mut text = b",".to_vec();
    text.extend_from_slice(file.slice(previous.span().between(first)));
    let mut last = first;
    if kind == VarKind::AwaitUsing {
        let using = skip_trivia(file.text(), first.end);
        text.extend_from_slice(file.slice(Span::after(first, using)));
        last = Span::new(using, using + "using".len() as u32);
    }
    let start = previous.semicolon().map_or_else(|| previous.span().end, |it| it.start);
    Some(fixer.replace(Span::new(start, last.end), text))
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
    let kind = kind_text(kind);
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
        // oxlint's `help` is what it calls its fix.
        .labels_with(|details| details.help = if previous().is_some() { "Combine variable declarations" } else { "" }.into())
        .fix(|fixer| join_declarations(fixer, statement, previous()?, kind));
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
            let apart = if self.separate_requires { counts.requires } else { 0 };
            scope.required |= apart > 0;
            scope.initialized |= counts.initialized > apart;
        }
        true
    }

    /// ESLint's `checkVariableDeclaration`. `seen`: what has been declared in the scope of `statement`, of its `kind`.
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
    /// Whether the file can have a `require`.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mut kinds = [KindOptions::default(); 5];
        if options.get(0).is_some_and(|it| it.as_object().is_some()) {
            let of_all = |key: &str| object.has(key).then(|| Mode::of(object.str(key)));
            for (kind, key) in kinds.iter_mut().zip(KEYS) {
                let mode = Mode::of(object.str(key));
                *kind = KindOptions {
                    uninitialized: of_all("uninitialized").unwrap_or(mode),
                    initialized: of_all("initialized").unwrap_or(mode),
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
        // Only what has to be declared together depends on what has been declared before.
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
        // As they end, which is how the parser leaves them.
        let all = || cx.file().stmts_of_kind(StmtTag::Var);
        if all().map(|it| it.span().end).is_sorted_by(|a, b| a < b) {
            return all().for_each(check);
        }
        let mut sorted: Vec<Stmt> = all().collect();
        utils::sort::sort_unstable_by_key(&mut sorted, |it| (it.span().end, Reverse(it.span().start)));
        sorted.into_iter().for_each(&mut check);
    }
}
