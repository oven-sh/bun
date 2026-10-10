use crate::import_minimatch::Glob;
use crate::import_type::{ImportType, ImportTypes};
use bun_core::strings;
use bun_lint::language::Parser;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::sort::sort_indices;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Enforce a convention in module import order.
pub struct Order {
    newlines_between: Newlines,
    newlines_between_types: Newlines,
    /// `pathGroupsExcludedImportTypes`: a bit for each [`ImportType`].
    excluded: u16,
    /// `sortTypesGroup`, if `type` is among the groups.
    sorts_types_group: bool,
    consolidates_islands: bool,
    named: Named,
    alphabetize: Alphabetize,
    distinct_group: bool,
    warn_on_unassigned_imports: bool,
    /// The rank of each [`ImportType`] but the last.
    groups: [f64; 9],
    is_type_in_groups: bool,
    path_groups: Vec<PathGroup>,
    max_position: f64,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Newlines {
    Ignore,
    Always,
    AlwaysAndInsideGroups,
    Never,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Direction {
    Ignore,
    Asc,
    Desc,
}

struct Alphabetize {
    order: Direction,
    order_import_kind: Direction,
    case_insensitive: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum NamedTypes {
    Mixed,
    First,
    Last,
}

struct Named {
    import: bool,
    export: bool,
    require: bool,
    cjs_exports: bool,
    types: NamedTypes,
}

struct PathGroup {
    glob: Glob,
    group: ImportType,
    position: f64,
}

/// `importKind` or `exportKind`. espree has neither.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum ImportKind {
    Undefined,
    Value,
    Type,
}

/// The `type` of an entry.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Written {
    Import,
    /// `import a = b.c`
    ImportObject,
    Require,
    Export,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Category {
    Named,
    Import,
    Exports,
}

struct Entry<'a> {
    /// What is reported.
    node: Span,
    /// `findRootNode(node)`
    root: Span,
    /// Where the root is in its block.
    index: usize,
    value: Cow<'a, [u8]>,
    display_name: Cow<'a, [u8]>,
    alias: Option<&'a [u8]>,
    written: Written,
    /// `node.importKind`
    import_kind: ImportKind,
    /// `node.exportKind === "type"`
    is_type_export: bool,
    rank: f64,
    is_multiline: bool,
}

const OUT_OF_ORDER: Message =
    Message::new("", "`{{second}}` {{secondKind}} should occur {{order}} {{firstKind}} of `{{first}}`");
const EMPTY_LINE_BETWEEN_GROUPS: Message =
    Message::new("", "There should be at least one empty line between import groups");
const NO_EMPTY_LINE_WITHIN_GROUP: Message = Message::new("", "There should be no empty line within import group");
const NO_EMPTY_LINE_BETWEEN_GROUPS: Message = Message::new("", "There should be no empty line between import groups");
const EMPTY_LINE_BEFORE_MULTILINE: Message = Message::new(
    "",
    "There should be at least one empty line between this import and the multi-line import that follows it",
);
const EMPTY_LINE_AFTER_MULTILINE: Message = Message::new(
    "",
    "There should be at least one empty line between this multi-line import and the import that follows it",
);
const NO_EMPTY_LINES_BETWEEN_SINGLE_LINES: Message = Message::new(
    "",
    "There should be no empty lines between this single-line import and the single-line import that follows it",
);

fn newlines_of(written: Option<&str>) -> Option<Newlines> {
    Some(match written? {
        "always" => Newlines::Always,
        "always-and-inside-groups" => Newlines::AlwaysAndInsideGroups,
        "never" => Newlines::Never,
        _ => Newlines::Ignore,
    })
}

fn direction_of(written: Option<&str>) -> Direction {
    match written {
        Some("asc") => Direction::Asc,
        Some("desc") => Direction::Desc,
        _ => Direction::Ignore,
    }
}

/// `convertPathGroupsForRanks`
fn path_groups_of(written: &[Json]) -> (Vec<PathGroup>, f64) {
    let (mut after, mut before) = ([0u32; 10], [0u32; 10]);
    let mut groups = Vec::with_capacity(written.len());
    for it in written {
        let it = Object::of(Some(it));
        let Some(group) = it.str("group").and_then(|it| ImportType::named(it.as_bytes())) else {
            continue;
        };
        let position = match it.str("position") {
            Some("after") => {
                after[group as usize] += 1;
                f64::from(after[group as usize])
            }
            // How many there are after it is not known yet.
            Some("before") => {
                before[group as usize] += 1;
                -f64::from(before[group as usize])
            }
            _ => 0.0,
        };
        groups.push(PathGroup { glob: Glob::of_path_group(it), group, position });
    }
    for it in groups.iter_mut().filter(|it| it.position < 0.0) {
        it.position = -(f64::from(before[it.group as usize]) + 1.0 + it.position);
    }
    let longest = after.iter().chain(&before).copied().max().unwrap_or(0);
    let mut max_position = 10u64;
    while max_position < u64::from(longest) {
        max_position *= 10;
    }
    (groups, max_position as f64)
}

impl Rule for Order {
    const META: Meta = Meta::plugin(Plugin::Import, "order", Kind::Suggestion)
        .fixable(Fixable::Code)
        .needs_modules()
        .reports_at_the_end();
    const ON: On = On::new().finish().var_decls().stmts(&[StmtTag::ExportNamed]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let newlines_between = newlines_of(options.str("newlines-between")).unwrap_or(Newlines::Ignore);
        // `convertGroupsToRanks`
        let types_of = |group: &Json| -> Vec<ImportType> {
            let items = group.as_array().unwrap_or_else(|| std::slice::from_ref(group));
            items.iter().filter_map(Json::as_str).filter_map(ImportType::named).collect()
        };
        let written: Vec<Vec<ImportType>> = match options.has("groups") {
            true => options.array("groups").iter().map(types_of).collect(),
            false => {
                use ImportType::{Builtin, External, Index, Parent, Sibling};
                [Builtin, External, Parent, Sibling, Index].map(|it| vec![it]).into()
            }
        };
        let mut groups = [f64::NAN; 9];
        for (index, group) in written.iter().enumerate() {
            for it in group {
                if let Some(rank) = groups.get_mut(*it as usize) {
                    *rank = (index * 2) as f64;
                }
            }
        }
        let is_type_in_groups = !groups[ImportType::Type as usize].is_nan();
        for rank in groups.iter_mut().filter(|it| it.is_nan()) {
            *rank = (written.len() * 2) as f64;
        }
        let excluded = match options.get("pathGroupsExcludedImportTypes") {
            Some(written) => types_of(written),
            None => vec![ImportType::Builtin, ImportType::External, ImportType::Object],
        };
        let named = options.object("named");
        let is_named = |key: &str| {
            let of_all = || named.bool("enabled");
            options.bool("named").or_else(|| named.bool(key)).or_else(of_all).unwrap_or(false)
        };
        let alphabetize = options.object("alphabetize");
        let (path_groups, max_position) = path_groups_of(options.array("pathGroups"));
        Order {
            newlines_between,
            newlines_between_types: newlines_of(options.str("newlines-between-types")).unwrap_or(newlines_between),
            excluded: excluded.iter().fold(0, |set, it| set | (1 << (*it as u16))),
            sorts_types_group: is_type_in_groups && options.bool_or("sortTypesGroup", false),
            consolidates_islands: options.str("consolidateIslands") == Some("inside-groups"),
            named: Named {
                import: is_named("import"),
                export: is_named("export"),
                require: is_named("require"),
                cjs_exports: is_named("cjsExports"),
                types: match named.str("types") {
                    Some("types-first") => NamedTypes::First,
                    Some("types-last") => NamedTypes::Last,
                    _ => NamedTypes::Mixed,
                },
            },
            alphabetize: Alphabetize {
                order: direction_of(alphabetize.str("order")),
                order_import_kind: direction_of(alphabetize.str("orderImportKind")),
                case_insensitive: alphabetize.bool_or("caseInsensitive", false),
            },
            distinct_group: options.bool_or("distinctGroup", true),
            warn_on_unassigned_imports: options.bool_or("warnOnUnassignedImports", false),
            groups,
            is_type_in_groups,
            path_groups,
            max_position,
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        let has_exports = self.named.cjs_exports && file.has_exprs([ExprTag::Assign]);
        if has_exports || file.has_stmts([StmtTag::Import, StmtTag::ImportEquals]) || file.has_exprs([ExprTag::Call]) {
            on = on.finish();
        }
        if self.named.require {
            on = on.var_decls();
        }
        if self.named.export {
            on = on.stmts(&[StmtTag::ExportNamed]);
        }
        on
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check_names_of_export(statement, cx);
    }

    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        self.check_names_of_require(declaration, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx);
    }
}

/// A `Literal`
fn is_literal(e: Expr) -> bool {
    use ExprKind::{BigInt, False, Null, Number, Regex, String, True};
    matches!(e.kind(), String(_) | Number(_) | True | False | Null | Regex(_) | BigInt(_))
}

/// `isRequireExpression`
fn is_require_expression(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Call(call) => {
            e.chain() == Chain::No
                && call.callee().as_ident().is_some_and(|it| it.bytes() == b"require")
                && call.args().len() == 1
                && call.args().first().is_some_and(is_literal)
        }
        _ => false,
    }
}

/// The `require("a")` for which `getRequireBlock` finds the statement that `init` is in: `require("a")`,
/// `require("a").b.c`, `require("a")()`. With its argument.
fn static_require_in<'a>(init: Expr<'a>) -> Option<(Expr<'a>, Name<'a>)> {
    let mut e = init;
    loop {
        if e.chain() != Chain::No {
            return None;
        }
        e = match e.kind() {
            ExprKind::Call(call) => match call.args().first().map(|it| it.kind()) {
                Some(ExprKind::String(name)) if is_require_expression(e) => return Some((e, name)),
                _ => call.callee(),
            },
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            _ => return None,
        };
    }
}

/// `canCrossNodeWhileReorder`
fn can_be_crossed(statement: Stmt) -> bool {
    match statement.kind() {
        StmtKind::Import(import) => {
            import.default().is_some() || import.namespace().is_some() || !import.named().is_empty()
        }
        // With `export` before it, it is in an `ExportNamedDeclaration`.
        StmtKind::ImportEquals(import) => {
            !statement.is_exported() && matches!(import.target(), ImportEqualsTarget::Require(_))
        }
        StmtKind::Var(declarations) if declarations.len() == 1 && !statement.is_exported() => {
            let Some((declaration, init)) = declarations.first().and_then(|it| Some((it, it.init()?))) else {
                return false;
            };
            let is_called_member = || match init.kind() {
                ExprKind::Call(call) if init.chain() == Chain::No => match call.callee().kind() {
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => is_require_expression(obj),
                    _ => false,
                },
                _ => false,
            };
            matches!(declaration.pat().tag(), PatTag::Ident | PatTag::Object)
                && (is_require_expression(init) || is_called_member())
        }
        _ => false,
    }
}

/// `text.slice(from, to)`
fn slice(text: &[u8], from: u32, to: u32) -> &[u8] {
    text.get(from as usize..to as usize).unwrap_or_default()
}

/// `text.substring(from, to)`
fn substring(text: &[u8], from: u32, to: u32) -> &[u8] {
    slice(text, from.min(to), from.max(to))
}

/// `commentOnSameLineAs`
fn is_comment_on_line(file: &File, token: Token, line: u32) -> bool {
    matches!(token.kind(), TokenKind::Line | TokenKind::Block)
        && file.line_of(token.start()) == line
        && file.line_of(token.end()) == line
}

/// Where the last of the comments ends that follow `root` on its last line.
fn end_with_comments<'a>(file: &'a File<'a>, root: Span) -> u32 {
    let line = file.line_of(root.end);
    let after = file.tokens_after(root).with_comments().take(100);
    let comments = after.take_while(|it| is_comment_on_line(file, *it, line));
    comments.last().map_or(root.end, |it| it.end())
}

/// `findEndOfLineWithComments`
fn end_of_line_with_comments<'a>(file: &'a File<'a>, root: Span) -> u32 {
    let mut end = end_with_comments(file, root);
    loop {
        match file.text().get(end as usize) {
            Some(b'\n') => return end + 1,
            Some(b' ' | b'\t' | b'\r') => end += 1,
            _ => return end,
        }
    }
}

/// `findStartOfLineWithComments`
fn start_of_line_with_comments<'a>(file: &'a File<'a>, root: Span) -> u32 {
    let line = file.line_of(root.end);
    let before = file.tokens_before(root).with_comments().take(100);
    let comments = before.take_while(|it| is_comment_on_line(file, *it, line));
    let mut start = comments.last().map_or(root.start, |it| it.start());
    // The first character of the text is never looked at.
    let first = file.line_span(1).start + 1;
    while start > first && matches!(file.text().get(start as usize - 1), Some(b' ' | b'\t')) {
        start -= 1;
    }
    start
}

/// `findOutOfOrder`: where they are.
fn find_out_of_order(ranks: &[f64]) -> Vec<usize> {
    let mut max = ranks.first().copied().unwrap_or(0.0);
    let is_out_of_order = |rank: f64| {
        let is_lower = rank < max;
        max = max.max(rank);
        is_lower
    };
    let marked = ranks.iter().copied().map(is_out_of_order).enumerate();
    marked.filter(|it| it.1).map(|it| it.0).collect()
}

/// `makeImportDescription`
fn description_of(entry: &Entry) -> &'static str {
    match (entry.written, entry.is_type_export, entry.import_kind) {
        (Written::Export, true, _) => "type export",
        (Written::Export, false, _) => "export",
        (_, _, ImportKind::Type) => "type import",
        _ => "import",
    }
}

/// The `name` of a name in the braces of an import or an export. One in quotes is a `Literal`, which has none.
fn name_of(name: Ident<'_>) -> &[u8] {
    if name.is_string() { b"undefined" } else { name.bytes() }
}

/// The `name` of a key that is an `Identifier`, in brackets or not.
fn identifier_of(key: Key<'_>) -> Option<&[u8]> {
    match key.kind() {
        KeyKind::Ident(name) => Some(name.bytes()),
        KeyKind::Computed(e) => Some(e.as_ident()?.bytes()),
        _ => None,
    }
}

/// The object and the name of a `MemberExpression` whose `property` is an `Identifier`.
fn member_of<'a>(e: Expr<'a>) -> Option<(Expr<'a>, &'a [u8])> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => Some((obj, name.bytes())),
        ExprKind::Index { obj, index, .. } => Some((obj, index.as_ident()?.bytes())),
        _ => None,
    }
}

/// `isCJSExports`
fn is_cjs_exports(e: Expr) -> bool {
    let name = match (member_of(e), e.as_ident()) {
        (Some((object, b"exports")), _) if object.as_ident().is_some_and(|it| it.bytes() == b"module") => "module",
        (None, Some(name)) if name.bytes() == b"exports" => "exports",
        _ => return false,
    };
    let scope = Node::Expr(e).scope();
    scope.get(name).is_none() && !(scope.kind() == ScopeKind::Global && e.file().global(name.as_bytes()).is_some())
}

/// `getNamedCJSExports`, joined.
fn named_cjs_export(target: Expr) -> Option<Vec<u8>> {
    let (mut root, mut parent, mut names) = (target, None, Vec::new());
    while matches!(root.tag(), ExprTag::Dot | ExprTag::Index) {
        let (object, name) = member_of(root)?;
        names.push(name);
        (parent, root) = (Some(root), object);
    }
    if !is_cjs_exports(root) {
        parent.filter(|it| is_cjs_exports(*it))?;
        names.pop();
    }
    names.reverse();
    (!names.is_empty()).then(|| names.join(&b"."[..]))
}

/// `findRootNode` of what is in `statement`.
fn root_of(mut statement: Stmt) -> Span {
    // An `if` and a `switch` have no `body`.
    for _ in 0..1000 {
        statement = match statement.parent() {
            Node::Stmt(parent) if parent.tag() == StmtTag::If => parent,
            Node::Case(case) => match case.parent() {
                Node::Stmt(parent) => parent,
                _ => break,
            },
            _ => break,
        };
    }
    statement.span()
}

impl Order {
    fn kind_of(cx: &Cx<Self>, is_type: bool) -> ImportKind {
        match (cx.language().parser, is_type) {
            (Parser::Espree, _) => ImportKind::Undefined,
            (_, true) => ImportKind::Type,
            (_, false) => ImportKind::Value,
        }
    }

    /// `computeRank`. `None`: it is not registered.
    fn rank_of(&self, value: &[u8], written: Written, is_type_only: bool, types: &ImportTypes) -> Option<f64> {
        let is_excluded = |it: ImportType| self.excluded & (1 << (it as u16)) != 0;
        let is_of_types = is_type_only && self.is_type_in_groups;
        let import_type = match written {
            Written::ImportObject => ImportType::Object,
            _ if is_of_types && !self.sorts_types_group => ImportType::Type,
            _ => types.of_name(value, written == Written::Require),
        };
        let of_path = || {
            let group = self.path_groups.iter().find(|it| it.glob.matches(value))?;
            Some(self.groups.get(group.group as usize)? + group.position / self.max_position)
        };
        let has_path_rank = !is_excluded(import_type) && !(is_of_types && is_excluded(ImportType::Type));
        let of_path = if has_path_rank { of_path() } else { None };
        let mut rank = of_path.or_else(|| self.groups.get(import_type as usize).copied())?;
        if is_type_only && self.sorts_types_group {
            rank = self.groups[ImportType::Type as usize] + rank / 10.0;
        }
        if written == Written::Require {
            rank += 100.0;
        }
        (rank != -1.0).then_some(rank)
    }

    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        if self.named.cjs_exports {
            self.check_cjs_exports(cx);
        }
        let Some(types) = ImportTypes::of(file) else {
            return;
        };
        self.check_block(file.body(), true, &types, cx);
        for statement in file.stmts_of_kind(StmtTag::Module) {
            if let StmtKind::Module(module) = statement.kind() {
                self.check_block(module.innermost().body(), false, &types, cx);
            }
        }
    }

    /// The imports of a `Program` or a `TSModuleBlock`.
    fn check_block<'a>(&self, body: List<'a, Stmt<'a>>, is_program: bool, types: &ImportTypes<'a>, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let mut imported: Vec<Entry<'a>> = Vec::new();
        let is_multiline = |span: Span| file.line_of(span.start) != file.line_of(span.end);
        for (index, statement) in body.iter().enumerate() {
            let root = statement.span();
            // `whole`: of which it is asked whether it is on several lines.
            let mut register = |(node, whole): (Span, Span), name: &'a [u8], written: Written, kind: ImportKind| {
                let value = if written == Written::ImportObject { &b""[..] } else { name };
                if let Some(rank) = self.rank_of(value, written, kind == ImportKind::Type, types) {
                    imported.push(Entry {
                        node,
                        root,
                        index,
                        value: Cow::Borrowed(value),
                        display_name: Cow::Borrowed(name),
                        alias: None,
                        written,
                        import_kind: kind,
                        is_type_export: false,
                        rank,
                        is_multiline: is_multiline(whole),
                    });
                }
            };
            match statement.kind() {
                StmtKind::Import(import) if can_be_crossed(statement) || self.warn_on_unassigned_imports => {
                    let name = import.spec().bytes();
                    register((root, root), name, Written::Import, Self::kind_of(cx, import.is_type_only()));
                    if self.named.import {
                        let names = import.named().iter().map(|it| {
                            let alias = it.is_renamed().then(|| it.local().bytes());
                            let kind = Self::kind_of(cx, it.is_type_only());
                            self.named_entry(it.span(), (name_of(it.imported()), alias), Written::Import, kind)
                        });
                        self.check_names(names.collect(), cx);
                    }
                }
                StmtKind::ImportEquals(import) if !statement.is_exported() => {
                    let kind = Self::kind_of(cx, import.flags().contains(Flags::TYPE_ONLY));
                    match import.target() {
                        ImportEqualsTarget::Require(Some(name)) => {
                            register((root, root), name.bytes(), Written::Import, kind);
                        }
                        ImportEqualsTarget::Entity(entity) => {
                            if let Some((first, last)) = entity.parts().next().zip(entity.parts().next_back()) {
                                let entity = file.slice(Span::new(first.start(), last.span().end));
                                register((root, root), entity, Written::ImportObject, kind);
                            }
                        }
                        ImportEqualsTarget::Require(None) => {}
                    }
                }
                StmtKind::Var(declarations) if is_program && !statement.is_exported() => {
                    for init in declarations.iter().filter_map(|it| it.init()) {
                        if let Some((call, name)) = static_require_in(init) {
                            // `importNode.parent.parent.type === "VariableDeclaration"`
                            let whole = if call == init { root } else { call.span() };
                            register((call.span(), whole), name.bytes(), Written::Require, ImportKind::Undefined);
                        }
                    }
                }
                _ => {}
            }
        }
        if imported.is_empty() {
            return;
        }
        if self.newlines_between != Newlines::Ignore || self.newlines_between_types != Newlines::Ignore {
            self.check_newlines(&imported, cx);
        }
        if self.alphabetize.order != Direction::Ignore {
            self.alphabetize(&mut imported);
        }
        self.report_out_of_order(imported, Category::Import, Some(body), cx);
    }

    /// `makeNewlinesBetweenReport`
    fn check_newlines<'a>(&self, imported: &[Entry<'a>], cx: &Cx<'a, Self>) {
        use Newlines::{Always, AlwaysAndInsideGroups, Ignore, Never};
        let file = cx.file();
        let sorts_types = self.sorts_types_group;
        let consolidates = self.consolidates_islands
            && (self.newlines_between == AlwaysAndInsideGroups || self.newlines_between_types == AlwaysAndInsideGroups);
        for (previous, current) in imported.iter().zip(imported.iter().skip(1)) {
            let mut lines = file.line_of(previous.node.end) + 1..file.line_of(current.node.start);
            let has_empty_lines = lines.any(|it| strings::is_all_js_whitespace(file.line_text(it)));
            let is_start_of_distinct_group = current.rank - 1.0 >= previous.rank;
            let is_type_only = current.import_kind == ImportKind::Type;
            let is_beside_other_kind = is_type_only != (previous.import_kind == ImportKind::Type) && sorts_types;
            let is_type_only = is_type_only && sorts_types;
            let is_either_multiline = previous.is_multiline || current.is_multiline;
            // Where they want the opposite, `consolidateIslands` wins.
            let between = match self.newlines_between {
                Never if sorts_types && consolidates && is_either_multiline => AlwaysAndInsideGroups,
                it => it,
            };
            let between_types = match self.newlines_between_types {
                Never if sorts_types && consolidates && (is_beside_other_kind || is_either_multiline) => {
                    AlwaysAndInsideGroups
                }
                it => it,
            };
            let own = if is_type_only { between_types } else { between };
            if own == Ignore {
                continue;
            }
            let applies = if is_type_only || is_beside_other_kind { between_types } else { between };
            let is_in_same_group = match self.distinct_group {
                true => current.rank == previous.rank,
                false => !is_start_of_distinct_group,
            };
            let add = |message: Message| {
                let end = end_with_comments(file, previous.root);
                cx.report(previous.node, message).fix(|fixer| fixer.insert_after(Span::empty(end), "\n"));
            };
            let remove = |message: Message| {
                let start = end_of_line_with_comments(file, previous.root);
                let end = start_of_line_with_comments(file, current.root);
                let is_blank = start <= end && strings::is_all_js_whitespace(slice(file.text(), start, end));
                cx.report(previous.node, message).fix(|fixer| is_blank.then(|| fixer.remove(Span::new(start, end))));
            };
            let mut is_reported = true;
            if matches!(applies, Always | AlwaysAndInsideGroups) {
                if current.rank != previous.rank && !has_empty_lines {
                    match self.distinct_group || is_start_of_distinct_group {
                        true => add(EMPTY_LINE_BETWEEN_GROUPS),
                        false => is_reported = false,
                    }
                } else if has_empty_lines && applies != AlwaysAndInsideGroups && is_in_same_group {
                    remove(NO_EMPTY_LINE_WITHIN_GROUP);
                } else {
                    is_reported = false;
                }
            } else if has_empty_lines && (!sorts_types || !is_beside_other_kind || between_types == Never) {
                remove(NO_EMPTY_LINE_BETWEEN_GROUPS);
            } else {
                is_reported = false;
            }
            if is_reported || !consolidates {
                continue;
            }
            if !has_empty_lines && current.is_multiline {
                add(EMPTY_LINE_BEFORE_MULTILINE);
            } else if !has_empty_lines && previous.is_multiline {
                add(EMPTY_LINE_AFTER_MULTILINE);
            } else if has_empty_lines && !is_either_multiline && is_in_same_group {
                remove(NO_EMPTY_LINES_BETWEEN_SINGLE_LINES);
            }
        }
    }

    /// `getSorter`. It is no order where a name that starts with `./` meets one that starts with `../`.
    fn compare(&self, a: (&[u8], ImportKind), b: (&[u8], ImportKind)) -> Ordering {
        let is_relative = |it: &[u8]| matches!(it, b"." | b"..");
        let (mut of_a, mut of_b) = (strings::split(a.0, b"/"), strings::split(b.0, b"/"));
        let mut is_first = true;
        let by_name = loop {
            match (of_a.next(), of_b.next()) {
                (Some(x), Some(y)) if is_first && is_relative(x) && is_relative(y) && x != y => {
                    // By how many names they have.
                    let (names_of_a, names_of_b) = (strings::count_char(a.0, b'/'), strings::count_char(b.0, b'/'));
                    break match (names_of_a, names_of_b) == (0, 0) {
                        true => strings::order_utf16(a.0, b.0),
                        false => names_of_a.cmp(&names_of_b),
                    };
                }
                (Some(x), Some(y)) => match strings::order_utf16(x, y) {
                    Ordering::Equal => is_first = false,
                    unequal => break unequal,
                },
                (None, None) => break Ordering::Equal,
                (None, Some(_)) => break Ordering::Less,
                (Some(_), None) => break Ordering::Greater,
            }
        };
        let in_direction = |ordering: Ordering, direction: Direction| match direction {
            Direction::Desc => ordering.reverse(),
            _ => ordering,
        };
        // "type" comes before "value", which is also what stands for none.
        let rank = |it: ImportKind| it != ImportKind::Type;
        in_direction(by_name, self.alphabetize.order).then_with(|| match self.alphabetize.order_import_kind {
            Direction::Ignore => Ordering::Equal,
            direction => in_direction(rank(a.1).cmp(&rank(b.1)), direction),
        })
    }

    /// `mutateRanksToAlphabetize`
    fn alphabetize(&self, imported: &mut [Entry]) {
        let ranks: Vec<f64> = {
            let normalized: Vec<Cow<[u8]>> = match self.alphabetize.case_insensitive {
                true => imported.iter().map(|it| text::to_lower_case(&it.value)).collect(),
                false => imported.iter().map(|it| Cow::Borrowed(&*it.value)).collect(),
            };
            let key = |at: u32| Some((imported.get(at as usize)?, &**normalized.get(at as usize)?));
            let mut order: Vec<u32> = (0..imported.len() as u32).collect();
            let rank = |at: u32| key(at).map_or(0.0, |it| it.0.rank);
            sort_indices(&mut order, &mut |a, b| rank(a).partial_cmp(&rank(b)).unwrap_or(Ordering::Equal));
            let is_before = |a: u32, b: u32| match (key(a), key(b)) {
                (Some(a), Some(b)) => self.compare((a.1, a.0.import_kind), (b.1, b.0.import_kind)) == Ordering::Less,
                _ => false,
            };
            // Each group as `Array.prototype.sort` sorts it, which what is no order depends on.
            for group in order.chunk_by_mut(|a, b| rank(*a) == rank(*b)).filter(|it| it.len() > 1) {
                utils::array_sort_by(group, &is_before);
            }
            // What has the same name and the same kind gets the rank of the last of them.
            let mut ranks: FxHashMap<(&[u8], ImportKind), f64> = FxHashMap::default();
            for (new_rank, it) in order.iter().filter_map(|at| imported.get(*at as usize)).enumerate() {
                ranks.insert((&*it.value, it.import_kind), it.rank.trunc() + new_rank as f64);
            }
            let new_ranks = imported.iter().map(|it| {
                let known = ranks.get(&(&*it.value, it.import_kind));
                known.copied().unwrap_or(it.rank)
            });
            new_ranks.collect()
        };
        imported.iter_mut().zip(ranks).for_each(|(it, rank)| it.rank = rank);
    }

    /// `makeOutOfOrderReport`. `body`: the block, where whole statements are moved that cannot cross everything.
    fn report_out_of_order<'a>(
        &self,
        mut imported: Vec<Entry<'a>>,
        category: Category,
        body: Option<List<'a, Stmt<'a>>>,
        cx: &Cx<'a, Self>,
    ) {
        let mut ranks: Vec<f64> = imported.iter().map(|it| it.rank).collect();
        let mut out_of_order = find_out_of_order(&ranks);
        if out_of_order.is_empty() {
            return;
        }
        // The direction in which less is reported.
        let reversed: Vec<f64> = ranks.iter().rev().map(|it| -it).collect();
        let reversed_out_of_order = find_out_of_order(&reversed);
        let is_reversed = reversed_out_of_order.len() < out_of_order.len();
        if is_reversed {
            imported.reverse();
            (ranks, out_of_order) = (reversed, reversed_out_of_order);
        }
        // How many of the statements before each cannot be crossed.
        let uncrossable: Vec<u32> = body.map_or_else(Vec::new, |body| {
            let counts = body.iter().scan(0, |count, it| {
                *count += u32::from(!can_be_crossed(it));
                Some(*count)
            });
            std::iter::once(0).chain(counts).collect()
        });
        // `canReorderItems`, which sorts the two indices as strings.
        let can_reorder = |first: usize, second: usize| {
            let (from, to) = match first.to_string() <= second.to_string() {
                true => (first, second + 1),
                false => (second, first + 1),
            };
            from >= to || uncrossable.get(from) == uncrossable.get(to)
        };
        // The highest rank so far: the first that is higher than a rank is where this gets higher than it.
        let highest: Vec<f64> = ranks
            .iter()
            .scan(f64::NEG_INFINITY, |highest, it| {
                *highest = highest.max(*it);
                Some(*highest)
            })
            .collect();
        for second in out_of_order {
            let Some(rank) = ranks.get(second) else {
                continue;
            };
            let first = highest.partition_point(|it| it <= rank);
            if cx.has_reported_too_much() {
                return;
            }
            Self::report_pair(&mut imported, (first, second), is_reversed, category, &can_reorder, cx);
        }
    }

    /// `fixOutOfOrder`
    fn report_pair<'a>(
        imported: &mut [Entry<'a>],
        (first, second): (usize, usize),
        is_after: bool,
        category: Category,
        can_reorder: &dyn Fn(usize, usize) -> bool,
        cx: &Cx<'a, Self>,
    ) {
        if imported.get(first).map(|it| &it.display_name) == imported.get(second).map(|it| &it.display_name) {
            for at in [first, second] {
                if let Some(it) = imported.get_mut(at)
                    && let Some(alias) = it.alias
                {
                    it.display_name = Cow::Owned([&*it.display_name, b" as ", alias].concat());
                }
            }
        }
        let (Some(first), Some(second)) = (imported.get(first), imported.get(second)) else {
            return;
        };
        let (file, text) = (cx.file(), cx.file().text());
        let report = cx
            .report(second.node, OUT_OF_ORDER)
            .data("second", second.display_name.clone())
            .data("secondKind", description_of(second))
            .data("order", if is_after { "after" } else { "before" })
            .data("firstKind", description_of(first))
            .data("first", first.display_name.clone());
        if category == Category::Named {
            // The names are looked at where the declaration is entered.
            let report = report.on_exit(false);
            // `findSpecifierStart`, `findSpecifierEnd`
            let around = |it: &Entry| Some((file.token_before(it.node)?.end(), file.token_after(it.node)?.start()));
            let Some(((first_start, first_end), (second_start, second_end))) = around(first).zip(around(second)) else {
                return;
            };
            let first_code = slice(text, first_start, first.node.end);
            let first_trivia = slice(text, first.node.end, first_end);
            let second_code = slice(text, second_start, second.node.end);
            let second_trivia = slice(text, second.node.end, second_end);
            report.fix(|fixer| match is_after {
                false => {
                    let trimmed = strings::trim_js_whitespace_end(second_trivia);
                    let gap = slice(text, first_end, second_start.saturating_sub(1));
                    let blanks = second_trivia.get(trimmed.len()..).unwrap_or_default();
                    let moved = [second_code, b",", trimmed, first_code, first_trivia, gap, blanks].concat();
                    fixer.replace(Span::new(first_start, second_end), moved)
                }
                true => {
                    let trimmed = strings::trim_js_whitespace_end(first_trivia);
                    let gap = slice(text, second_end + 1, first_start);
                    let blanks = first_trivia.get(trimmed.len()..).unwrap_or_default();
                    let moved = [gap, first_code, b",", trimmed, second_code, blanks].concat();
                    fixer.replace(Span::new(second_start, first_end), moved)
                }
            });
            return;
        }
        if category != Category::Exports && !can_reorder(first.index, second.index) {
            return;
        }
        report.fix(|fixer| {
            let lines_of = |it: &Entry| {
                (start_of_line_with_comments(file, it.root), end_of_line_with_comments(file, it.root))
            };
            let ((first_start, first_end), (second_start, second_end)) = (lines_of(first), lines_of(second));
            let moved = substring(text, second_start, second_end);
            let line_break: &[u8] = if moved.ends_with(b"\n") { b"" } else { b"\n" };
            let ((start, end), replacement) = match is_after {
                false => ((first_start, second_end), [moved, line_break, substring(text, first_start, second_start)]),
                true => ((second_start, first_end), [substring(text, second_end, first_end), moved, line_break]),
            };
            (start <= end).then(|| fixer.replace(Span::new(start, end), replacement.concat()))
        });
    }

    /// An element of what `makeNamedOrderReport` is called with.
    fn named_entry<'a>(
        &self,
        node: Span,
        (name, alias): (&'a [u8], Option<&'a [u8]>),
        written: Written,
        kind: ImportKind,
    ) -> Entry<'a> {
        let is_type = kind == ImportKind::Type;
        Entry {
            node,
            root: node,
            index: 0,
            value: Cow::Owned([name, b":", alias.unwrap_or_default()].concat()),
            display_name: Cow::Borrowed(name),
            alias,
            written,
            import_kind: if written == Written::Import { kind } else { ImportKind::Undefined },
            is_type_export: written == Written::Export && is_type,
            rank: match self.named.types {
                NamedTypes::Mixed => 0.0,
                NamedTypes::First => f64::from(!is_type),
                NamedTypes::Last => f64::from(is_type),
            },
            is_multiline: false,
        }
    }

    /// `makeNamedOrderReport`
    fn check_names<'a>(&self, mut names: Vec<Entry<'a>>, cx: &Cx<'a, Self>) {
        if names.len() > 1 {
            if self.alphabetize.order != Direction::Ignore {
                self.alphabetize(&mut names);
            }
            self.report_out_of_order(names, Category::Named, None, cx);
        }
    }

    /// `const { b, a } = require("c")`
    fn check_names_of_require<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = declaration.pat().kind() else {
            return;
        };
        if !declaration.init().is_some_and(is_require_expression) {
            return;
        }
        let names = properties.iter().map(|it| {
            let name = identifier_of(it.key().filter(|_| it.default().is_none())?)?;
            let PatKind::Ident(value) = it.value().kind() else {
                return None;
            };
            let alias = (!it.is_shorthand()).then(|| value.bytes());
            Some(self.named_entry(it.span(), (name, alias), Written::Require, ImportKind::Undefined))
        });
        if let Some(names) = names.collect::<Option<Vec<_>>>() {
            self.check_names(names, cx);
        }
    }

    /// `export { b, a }`
    fn check_names_of_export<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ExportNamed(export) = statement.kind() else {
            return;
        };
        let names = export.items().iter().map(|it| {
            let alias = (it.is_renamed() && !it.exported().is_string()).then(|| it.exported().bytes());
            let kind = Self::kind_of(cx, it.is_type_only());
            self.named_entry(it.span(), (name_of(it.local()), alias), Written::Export, kind)
        });
        self.check_names(names.collect(), cx);
    }

    /// `module.exports = { b, a }`, and `exports.b = ..; exports.a = ..`.
    fn check_cjs_exports<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        let mut blocks: FxHashMap<(u32, u32, bool), Vec<Entry<'a>>> = FxHashMap::default();
        for e in file.exprs_of_kind(ExprTag::Assign) {
            let (ExprKind::Assign { target, value, .. }, Node::Stmt(statement)) = (e.kind(), e.parent()) else {
                continue;
            };
            if statement.tag() != StmtTag::Expr {
                continue;
            }
            if is_cjs_exports(target) {
                let ExprKind::Object(properties) = value.kind() else {
                    continue;
                };
                let names = properties.iter().map(|it| {
                    let (name, value) = (identifier_of(it.key()?)?, it.value()?.as_ident()?);
                    let alias = (it.kind() != PropKind::Shorthand).then(|| value.bytes());
                    Some(self.named_entry(it.span(), (name, alias), Written::Export, ImportKind::Undefined))
                });
                if let Some(names) = names.collect::<Option<Vec<_>>>() {
                    self.check_names(names, cx);
                }
            } else if let Some(name) = named_cjs_export(target) {
                let block = statement.parent();
                let key = (block.span().start, block.span().end, matches!(block, Node::Case(_)));
                blocks.entry(key).or_default().push(Entry {
                    node: e.span(),
                    root: root_of(statement),
                    index: 0,
                    value: Cow::Owned(name.clone()),
                    display_name: Cow::Owned(name),
                    alias: None,
                    written: Written::Export,
                    import_kind: ImportKind::Undefined,
                    is_type_export: false,
                    rank: 0.0,
                    is_multiline: false,
                });
            }
        }
        if self.alphabetize.order == Direction::Ignore {
            return;
        }
        for mut exported in blocks.into_values() {
            utils::sort::sort_by_key(&mut exported, |it| it.node.start);
            self.alphabetize(&mut exported);
            self.report_out_of_order(exported, Category::Exports, None, cx);
        }
    }
}
