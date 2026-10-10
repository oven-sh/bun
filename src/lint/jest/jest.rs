//! What the rules of oxlint for Jest and Vitest are written with, on the handles: its `utils/jest.rs`, `utils/jest/parse_jest_fn.rs`,
//! `utils/vitest.rs`, `utils/vitest/valid_vitest_fn.rs` and what `frameworks.rs` says about tests. Each function has the name that it
//! has there.
//!
//! - A rule exists twice, for `jest` and for `vitest`. What it does is compiled once, in `jest_*.rs` beside this file: a function
//!   there takes a [`Ctx`], which is not generic, and the two rules are wrappers.
//! - A `CallExpression` is the `Expr` of a `Call`. Text is bytes.
//! - Which calls may be calls of Jest is found once for a file, whatever the number of rules: [`iter_possible_jest_call_node`].
//! - oxlint recurses along `a.b().c().d..`. Here these are loops.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{scope_made_by, static_property_info};
use bun_lint_oxlint::codegen::Codegen;
use bun_lint_oxlint::hash_order::HashOrder;
use bun_lint_oxlint::import::import_entries;
use bun_lint_oxlint::regex_flags::rust_regex;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::cell::OnceCell;

/// What a function that two rules share needs of the rule that it runs for: `Ctx { file: cx.file(), report: &|at, message|
/// cx.report(at, message) }`.
pub(crate) struct Ctx<'a, 'r> {
    pub(crate) file: &'a File<'a>,
    pub(crate) report: &'r dyn Fn(Span, Message) -> Report<'a>,
}

impl<'a> Ctx<'a, '_> {
    pub(crate) fn report(&self, at: impl Spanned, message: Message) -> Report<'a> {
        (self.report)(at.span(), message)
    }
}

pub(crate) static JEST_METHOD_NAMES: [&str; 19] = [
    "afterAll",
    "afterEach",
    "beforeAll",
    "beforeEach",
    "bench",
    "describe",
    "expect",
    "expectTypeOf",
    "fdescribe",
    "fit",
    "it",
    "jest",
    "pending",
    "suite",
    "test",
    "vi",
    "xdescribe",
    "xit",
    "xtest",
];

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum JestFnKind {
    Expect,
    ExpectTypeOf,
    General(JestGeneralFnKind),
    VitestFixture,
    Unknown,
}

impl JestFnKind {
    pub(crate) fn from(name: &[u8]) -> Self {
        match name {
            b"expect" => JestFnKind::Expect,
            b"expectTypeOf" => JestFnKind::ExpectTypeOf,
            b"vi" | b"vitest" => JestFnKind::General(JestGeneralFnKind::Vitest),
            b"bench" => JestFnKind::General(JestGeneralFnKind::Bench),
            b"jest" => JestFnKind::General(JestGeneralFnKind::Jest),
            b"describe" | b"fdescribe" | b"xdescribe" | b"suite" => {
                JestFnKind::General(JestGeneralFnKind::Describe)
            }
            b"fit" | b"it" | b"test" | b"xit" | b"xtest" => {
                JestFnKind::General(JestGeneralFnKind::Test)
            }
            b"beforeAll" | b"beforeEach" | b"afterAll" | b"afterEach" => {
                JestFnKind::General(JestGeneralFnKind::Hook)
            }
            _ => JestFnKind::Unknown,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum JestGeneralFnKind {
    Hook,
    Describe,
    Test,
    Jest,
    Vitest,
    Bench,
}

// ───────────────────────────── what is known about a file ─────────────────────────────

/// What is found out about a file once. It holds no handles: it is kept with the file.
struct PerFile {
    /// `ctx.frameworks().is_jest()`: the file is named like a test, or imports something from `@jest/globals`.
    is_jest: bool,
    is_vitest: bool,
    possible_jest_nodes: OnceCell<PossibleJestNodes>,
}

#[derive(Default)]
struct PossibleJestNodes {
    /// The names under which something is imported from Jest or Vitest.
    originals: Vec<Box<[u8]>>,
    calls: Vec<PossibleCall>,
}

struct PossibleCall {
    span: Span,
    /// The number of the expression.
    id: u32,
    /// The index in `originals`, if there is one.
    original: u32,
    /// Of the name that the chain starts with, as it is where it is from.
    kind: JestFnKind,
    /// The number of the identifier that the chain starts with.
    reference: u32,
    /// The how manyth of the names that the file imports it is. `u32::MAX` for a global.
    import_index: u32,
}

pub(crate) fn is_vitest_import_source(source: &[u8]) -> bool {
    matches!(source, b"vitest" | b"vite-plus/test" | b"@effect/vitest")
}

fn has_component_tests(path: &[u8]) -> bool {
    strings::contains(path, b"__tests__")
        && strings::split_any(path, b"/\\").any(|it| it == b"__tests__")
}

/// `foo/bar.test.ts`, `__tests__/foo.ts`
fn is_jestlike_file(path: &[u8]) -> bool {
    let file_name = bun_lint::paths::file_name(path);
    let name_or_first_ext = strings::rsplit_once_char(file_name, b'.')
        .map(|(rest, _)| strings::rsplit_once_char(rest, b'.').map_or(rest, |it| it.1));
    matches!(name_or_first_ext, Some(b"test" | b"spec")) || has_component_tests(path)
}

/// Not what [`is_jest`] says: it goes by other endings, and not by what is imported.
pub(crate) fn is_jest_file(file: &File) -> bool {
    let path = file.path();
    has_component_tests(path)
        || strings::rsplit_once_char(path, b'.').is_some_and(|(rest, extension)| {
            matches!(
                extension,
                b"js" | b"jsx" | b"ts" | b"tsx" | b"mjs" | b"cjs" | b"mts" | b"cts"
            ) && (rest.ends_with(b"spec") || rest.ends_with(b"test"))
        })
}

/// `None` only if something else is kept with the file.
fn per_file<'a>(file: &'a File<'a>) -> Option<&'a PerFile> {
    file.extension(|| {
        let imports_tests = file.mentions_any(&[
            "vitest",
            "vite-plus/test",
            "@effect/vitest",
            "@jest/globals",
        ]);
        let imports = |is_source: fn(&[u8]) -> bool| {
            imports_tests && import_entries(file).any(|it| is_source(it.declaration.spec().bytes()))
        };
        PerFile {
            is_jest: is_jestlike_file(file.path()) || imports(|source| source == b"@jest/globals"),
            is_vitest: imports(is_vitest_import_source),
            possible_jest_nodes: OnceCell::new(),
        }
    })
}

/// `ctx.frameworks().is_vitest()`: the file imports something from Vitest. Its name does not matter.
pub(crate) fn is_vitest<'a>(file: &'a File<'a>) -> bool {
    per_file(file).is_some_and(|it| it.is_vitest)
}

/// `ctx.frameworks().is_test()`: in other files oxlint does not call `run_on_jest_node`.
pub(crate) fn is_test<'a>(file: &'a File<'a>) -> bool {
    per_file(file).is_some_and(|it| it.is_jest || it.is_vitest)
}

/// A call that may be one of Jest.
#[derive(Copy, Clone)]
pub(crate) struct PossibleJestNode<'a> {
    /// A `Call`.
    pub(crate) node: Expr<'a>,
    /// The name that what is called has in `@jest/globals` or in Vitest, if it is imported by name from there.
    pub(crate) original: Option<&'a [u8]>,
    /// What [`JestFnKind::from`] says of the name that the chain starts with, where that is known: most rules are about `expect`
    /// only, or not about it, and need not parse the rest.
    kind: Option<JestFnKind>,
    /// The identifier that the chain starts with, and the how manyth of the names that the file imports it is: `u32::MAX` for a
    /// global. For [`OxlintOrder`].
    reference: Option<(Expr<'a>, u32)>,
}

impl<'a> PossibleJestNode<'a> {
    /// For a call that is looked at by what is written only.
    pub(crate) fn new(node: Expr<'a>) -> Self {
        PossibleJestNode {
            node,
            original: None,
            kind: None,
            reference: None,
        }
    }

    fn of(file: &'a File<'a>, found: &'a PossibleJestNodes, call: &PossibleCall) -> Self {
        PossibleJestNode {
            node: Expr::from_raw(file, call.id),
            original: found.originals.get(call.original as usize).map(|it| &**it),
            kind: Some(call.kind),
            reference: Some((Expr::from_raw(file, call.reference), call.import_index)),
        }
    }
}

/// Every call of a global of Jest, of what is imported from Jest or Vitest, and of what these calls and their members return: of
/// `expect(1).toBe(1)` both `expect(1).toBe(1)` and `expect(1)`.
///
/// In the order of the source, what is around before what is in it. oxlint has them in another order, and most rules that depend on
/// it sort them like this. For the others there is [`OxlintOrder`]. `collect_possible_jest_call_node` is the same.
pub(crate) fn iter_possible_jest_call_node<'a>(
    file: &'a File<'a>,
) -> impl Iterator<Item = PossibleJestNode<'a>> {
    let found = per_file(file).map(|it| {
        it.possible_jest_nodes
            .get_or_init(|| collect_possible_jest_call_node(file))
    });
    found.into_iter().flat_map(move |found| {
        found
            .calls
            .iter()
            .map(move |call| PossibleJestNode::of(file, found, call))
    })
}

/// The one of [`iter_possible_jest_call_node`] that is the call `node`.
pub(crate) fn possible_jest_node_of<'a>(
    file: &'a File<'a>,
    node: Expr<'a>,
) -> Option<PossibleJestNode<'a>> {
    let found = per_file(file)?
        .possible_jest_nodes
        .get_or_init(|| collect_possible_jest_call_node(file));
    let key = |span: Span| (span.start, std::cmp::Reverse(span.end));
    let call = found.calls.get(
        found
            .calls
            .partition_point(|it| key(it.span) < key(node.span())),
    )?;
    (call.id == node.id().0).then(|| PossibleJestNode::of(file, found, call))
}

fn collect_possible_jest_call_node<'a>(file: &'a File<'a>) -> PossibleJestNodes {
    let mut found = PossibleJestNodes::default();
    let imports_tests = file.mentions_any(&[
        "vitest",
        "vite-plus/test",
        "@effect/vitest",
        "@jest/globals",
    ]);
    for (import_index, entry) in import_entries(file)
        .take_while(|_| imports_tests)
        .enumerate()
    {
        let source = entry.declaration.spec().bytes();
        if source != b"@jest/globals" && !is_vitest_import_source(source) {
            continue;
        }
        let Some(symbol) = file.top_level_scope().get_name(entry.local_name().name()) else {
            continue;
        };
        let original = match entry.import_name {
            bun_lint_oxlint::import::ImportImportName::Name(specifier) => {
                found.originals.push(specifier.imported().bytes().into());
                found.originals.len() as u32 - 1
            }
            _ => u32::MAX,
        };
        let references = symbol.references().filter_map(Reference::expr);
        references.for_each(|it| found.add_calls_of(it, original, import_index as u32));
    }
    // What the names resolve to is asked only where one of them starts a chain: `test` is also the name of a method.
    let globals: SmallVec<[Name; 19]> = JEST_METHOD_NAMES
        .iter()
        .filter(|name| file.mentions(name))
        .map(|name| file.name_of(name))
        .collect();
    if !globals.is_empty() {
        let is_global = |e: &Expr<'a>| {
            e.as_ident().is_some_and(|name| globals.contains(&name))
                && parent_expression(*e).is_some_and(|it| {
                    matches!(it.tag(), ExprTag::Call | ExprTag::TaggedTemplate) || is_member(it)
                })
                && e.symbol().is_none()
        };
        file.exprs_of_kind(ExprTag::Ident)
            .filter(is_global)
            .for_each(|it| found.add_calls_of(it, u32::MAX, u32::MAX));
    }
    utils::sort::sort_unstable_by_key(&mut found.calls, |it| {
        (it.span.start, std::cmp::Reverse(it.span.end))
    });
    found
}

impl PossibleJestNodes {
    /// The longest chain of calls, members and tagged templates that starts with `reference`.
    fn add_calls_of(&mut self, reference: Expr, original: u32, import_index: u32) {
        let local = reference.as_ident().map_or(b"".as_slice(), Name::bytes);
        let kind = JestFnKind::from(
            self.originals
                .get(original as usize)
                .map_or(local, |it| &**it),
        );
        let mut at = reference;
        while let Some(parent) = parent_expression(at) {
            match parent.kind() {
                ExprKind::Call(call) if call.callee() == at => {
                    let (span, id, reference) = (parent.span(), parent.id().0, reference.id().0);
                    self.calls.push(PossibleCall {
                        span,
                        id,
                        original,
                        kind,
                        reference,
                        import_index,
                    });
                }
                ExprKind::Dot { .. } if !parent.is_private_member() => {}
                ExprKind::Index { .. } | ExprKind::TaggedTemplate(_) => {}
                _ => return,
            }
            at = parent;
        }
    }
}

/// The expression that `e` is directly part of. `None` where oxc has something between the two: parentheses, or the
/// `ChainExpression` around an optional chain.
pub(crate) fn parent_expression(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.parent() {
        Node::Expr(parent) if !e.is_parenthesized() && !e.is_chain_root() => Some(parent),
        _ => None,
    }
}

/// `matches!(parent_kind, CallExpression | StaticMemberExpression | ComputedMemberExpression)`, whatever part of it `e` is: an
/// argument too.
pub(crate) fn is_in_call_or_member(e: Expr) -> bool {
    parent_expression(e).is_some_and(|parent| parent.tag() == ExprTag::Call || is_member(parent))
}

/// `StaticMemberExpression | ComputedMemberExpression`
fn is_member(e: Expr) -> bool {
    match e.tag() {
        ExprTag::Dot => !e.is_private_member() && !e.is_jsx_tag_name(),
        tag => tag == ExprTag::Index,
    }
}

// ───────────────────────────── the parser of calls ─────────────────────────────

pub(crate) type Members<'a> = SmallVec<[KnownMemberExpressionProperty<'a>; 4]>;

pub(crate) enum ParsedJestFnCall<'a> {
    GeneralJest(ParsedGeneralJestFnCall<'a>),
    Expect(ParsedExpectFnCall<'a>),
    ExpectTypeOf(ParsedExpectFnCall<'a>),
    Fixture(ParsedGeneralJestFnCall<'a>),
}

impl ParsedJestFnCall<'_> {
    pub(crate) fn kind(&self) -> JestFnKind {
        match self {
            ParsedJestFnCall::GeneralJest(call) | ParsedJestFnCall::Fixture(call) => call.kind,
            ParsedJestFnCall::Expect(call) | ParsedJestFnCall::ExpectTypeOf(call) => call.kind,
        }
    }
}

pub(crate) struct ParsedGeneralJestFnCall<'a> {
    pub(crate) kind: JestFnKind,
    /// The `only` and the `each` of `it.only.each(..)(..)`.
    pub(crate) members: Members<'a>,
    /// The `it`, as it is called where it is from.
    pub(crate) name: &'a [u8],
}

pub(crate) struct ParsedExpectFnCall<'a> {
    pub(crate) kind: JestFnKind,
    pub(crate) members: Members<'a>,
    pub(crate) name: &'a [u8],
    /// As it is called in the file.
    pub(crate) local: &'a [u8],
    /// The `expect`.
    pub(crate) head: KnownMemberExpressionProperty<'a>,
    /// Those of the call that is parsed: the `2` of `expect(1).toBe(2)`, the `1` of `expect(1)`.
    pub(crate) args: List<'a, Expr<'a>>,
    /// The indices in `members` of `not`, `resolves` and `rejects`.
    pub(crate) modifier_indices: SmallVec<[usize; 2]>,
    /// The index in `members` of the `toBe`.
    pub(crate) matcher_index: Option<usize>,
    pub(crate) expect_error: Option<ExpectError>,
    /// The `1` of `expect(1).toBe(2)`.
    pub(crate) expect_arguments: Option<List<'a, Expr<'a>>>,
    /// The `2` of `expect(1).toBe(2)`. `None` for `expect(1)`.
    pub(crate) matcher_arguments: Option<List<'a, Expr<'a>>>,
}

impl<'a> ParsedExpectFnCall<'a> {
    pub(crate) fn matcher(&self) -> Option<&KnownMemberExpressionProperty<'a>> {
        self.members.get(self.matcher_index?)
    }

    /// In the order of the source.
    pub(crate) fn modifiers(&self) -> impl Iterator<Item = &KnownMemberExpressionProperty<'a>> {
        self.modifier_indices
            .iter()
            .filter_map(|i| self.members.get(*i))
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ExpectError {
    ModifierUnknown,
    MatcherNotFound,
    MatcherNotCalled,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum KnownMemberExpressionParentKind {
    Member,
    Call,
    TaggedTemplate,
}

/// A link of the chain: what it starts with, or the name of a member.
#[derive(Copy, Clone)]
pub(crate) struct KnownMemberExpressionProperty<'a> {
    pub(crate) element: MemberExpressionElement<'a>,
    /// For the name of a member the `Dot` or the `Index`.
    pub(crate) parent: Option<Expr<'a>>,
    pub(crate) parent_kind: Option<KnownMemberExpressionParentKind>,
    pub(crate) grandparent_kind: Option<KnownMemberExpressionParentKind>,
    /// Of the name, with its quotes.
    pub(crate) span: Span,
}

#[derive(Copy, Clone)]
pub(crate) enum MemberExpressionElement<'a> {
    /// An identifier, or the `"b"` of `a["b"]`, which can be a template.
    Expression(Expr<'a>),
    /// The `b` of `a.b`.
    IdentName(Ident<'a>),
}

impl MemberExpressionElement<'_> {
    pub(crate) fn is_string_literal(&self) -> bool {
        matches!(self, MemberExpressionElement::Expression(e) if matches!(e.tag(), ExprTag::String | ExprTag::Template))
    }
}

impl<'a> KnownMemberExpressionProperty<'a> {
    pub(crate) fn name(&self) -> Option<&'a [u8]> {
        match self.element {
            MemberExpressionElement::IdentName(name) => Some(name.bytes()),
            MemberExpressionElement::Expression(e) => match e.kind() {
                ExprKind::Ident(name) | ExprKind::String(name) => Some(name.bytes()),
                ExprKind::Template(template) => template.as_static().map(Name::bytes),
                _ => None,
            },
        }
    }

    pub(crate) fn is_name_equal(&self, name: &str) -> bool {
        self.name() == Some(name.as_bytes())
    }

    pub(crate) fn is_name_unequal(&self, name: &str) -> bool {
        !self.is_name_equal(name)
    }

    /// `is_name_in_modifiers`
    fn is_any_of(&self, names: &[&str]) -> bool {
        self.name()
            .is_some_and(|name| names.iter().any(|it| it.as_bytes() == name))
    }
}

/// `get_node_chain`, after `resolve_first_ident`: the identifier that `callee` starts with, and then the names of the members, in the
/// order of the source. `None` if it starts with something else, or if there is something else on the way than members, calls and
/// tagged templates.
fn get_node_chain(callee: Expr<'_>) -> Option<Members<'_>> {
    use KnownMemberExpressionParentKind::{Call, Member, TaggedTemplate};
    let mut chain = Members::new();
    let (mut at, mut parent) = (callee, None);
    let (mut parent_kind, mut grandparent_kind) = (Some(Call), None);
    loop {
        if at.is_parenthesized() {
            return None;
        }
        let (next, kind) = match at.kind() {
            ExprKind::Ident(_) => {
                let element = MemberExpressionElement::Expression(at);
                chain.push(KnownMemberExpressionProperty {
                    element,
                    parent,
                    parent_kind,
                    grandparent_kind,
                    span: at.span(),
                });
                chain.reverse();
                return Some(chain);
            }
            ExprKind::Dot { obj, name, .. } => {
                if !at.is_private_member() {
                    chain.push(KnownMemberExpressionProperty {
                        element: MemberExpressionElement::IdentName(name),
                        parent: Some(at),
                        parent_kind: Some(Member),
                        grandparent_kind: parent_kind,
                        span: name.span(),
                    });
                }
                (obj, Member)
            }
            ExprKind::Index { obj, index, .. } => {
                if let Some((span, _)) = static_property_info(at) {
                    chain.push(KnownMemberExpressionProperty {
                        element: MemberExpressionElement::Expression(index),
                        parent: Some(at),
                        parent_kind: Some(Member),
                        grandparent_kind: parent_kind,
                        span,
                    });
                }
                (obj, Member)
            }
            ExprKind::Call(call) => (call.callee(), Call),
            ExprKind::TaggedTemplate(call) => (call.callee(), TaggedTemplate),
            _ => return None,
        };
        (parent, grandparent_kind, parent_kind) = (Some(at), parent_kind, Some(kind));
        at = next;
    }
}

pub(crate) fn parse_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedJestFnCall<'a>> {
    parse_jest_fn_call_in(file, possible_jest_node.node, possible_jest_node)
}

/// Parses the call `call_expr`. What it is part of is asked of the node of `possible_jest_node`: some rules pass another than the call.
pub(crate) fn parse_jest_fn_call_in<'a>(
    file: &'a File<'a>,
    call_expr: Expr<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedJestFnCall<'a>> {
    let PossibleJestNode { node, original, .. } = possible_jest_node;
    let call_expr = call_expr.as_call()?;
    let callee = call_expr.callee();
    let (is_jest, is_vitest) =
        per_file(file).map_or((false, false), |it| (it.is_jest, it.is_vitest));

    // Most calls of a file that is no test.
    if !is_jest
        && !is_vitest
        && !callee.is_parenthesized()
        && let Some(local) = callee.as_ident()
    {
        let name = original.unwrap_or_else(|| local.bytes());
        if name != b"each" && JestFnKind::from(name) == JestFnKind::Unknown && name != b"pending" {
            return (!is_in_call_or_member(node)).then(|| {
                ParsedJestFnCall::GeneralJest(ParsedGeneralJestFnCall {
                    kind: JestFnKind::Unknown,
                    members: Members::new(),
                    name,
                })
            });
        }
    }

    let mut chain = get_node_chain(callee)?;
    let local = chain.first()?.name()?;
    let name = original.unwrap_or(local);
    let is_member = |it: &KnownMemberExpressionProperty| {
        it.parent_kind == Some(KnownMemberExpressionParentKind::Member)
    };
    let all_member_expr_except_last = chain.iter().rev().skip(1).all(is_member);
    let is_each = chain.last()?.is_name_equal("each");

    // `.each()` is parsed with the call of what it returns: `.each()()`.
    if is_each && !matches!(callee.tag(), ExprTag::Call | ExprTag::TaggedTemplate) {
        return None;
    }
    if !is_each && callee.tag() == ExprTag::TaggedTemplate {
        return None;
    }

    let kind = JestFnKind::from(name);
    let head = chain.remove(0);
    let members = chain;

    if matches!(kind, JestFnKind::Expect | JestFnKind::ExpectTypeOf) {
        return parse_jest_expect_fn_call(node, call_expr, members, name, local, head, kind);
    }

    // Only the whole of `x().y.z()` is a call of Jest, not the `x()`.
    if is_in_call_or_member(node) {
        return None;
    }

    if matches!(
        kind,
        JestFnKind::General(JestGeneralFnKind::Jest | JestGeneralFnKind::Vitest)
    ) {
        return Some(ParsedJestFnCall::GeneralJest(ParsedGeneralJestFnCall {
            kind,
            members,
            name,
        }));
    }

    if !all_member_expr_except_last {
        return None;
    }

    if is_jest || is_vitest {
        if !(is_jest && is_valid_jest_call(name, &members)
            || is_vitest && is_valid_vitest_call(name, &members))
        {
            return None;
        }
        if is_vitest
            && members.iter().find_map(KnownMemberExpressionProperty::name)
                == Some(b"extend".as_slice())
        {
            return Some(ParsedJestFnCall::Fixture(ParsedGeneralJestFnCall {
                kind: JestFnKind::VitestFixture,
                members,
                name,
            }));
        }
    }
    Some(ParsedJestFnCall::GeneralJest(ParsedGeneralJestFnCall {
        kind,
        members,
        name,
    }))
}

fn parse_jest_expect_fn_call<'a>(
    node: Expr<'a>,
    call_expr: Call<'a>,
    members: Members<'a>,
    name: &'a [u8],
    local: &'a [u8],
    head: KnownMemberExpressionProperty<'a>,
    kind: JestFnKind,
) -> Option<ParsedJestFnCall<'a>> {
    let (modifier_indices, matcher_index, mut expect_error) =
        match find_modifiers_and_matcher(&members) {
            Ok((modifiers, matcher)) => (modifiers, Some(matcher), None),
            Err(error) => (SmallVec::new(), None, Some(error)),
        };

    // Of a chain that is not valid only the topmost call is reported.
    if expect_error.is_some() && !is_top_most_call_expr(node) {
        return None;
    }
    if expect_error == Some(ExpectError::MatcherNotFound)
        && parent_expression(node).is_some_and(is_member)
    {
        expect_error = Some(ExpectError::MatcherNotCalled);
    }

    let parsed_expect_fn = ParsedExpectFnCall {
        kind,
        expect_arguments: head.parent.and_then(Expr::as_call).map(Call::args),
        matcher_arguments: matcher_index.map(|_| call_expr.args()),
        head,
        members,
        name,
        local,
        args: call_expr.args(),
        matcher_index,
        modifier_indices,
        expect_error,
    };
    Some(match kind {
        JestFnKind::ExpectTypeOf => ParsedJestFnCall::ExpectTypeOf(parsed_expect_fn),
        _ => ParsedJestFnCall::Expect(parsed_expect_fn),
    })
}

/// The indices of the modifiers and of the matcher.
fn find_modifiers_and_matcher(
    members: &[KnownMemberExpressionProperty],
) -> Result<(SmallVec<[usize; 2]>, usize), ExpectError> {
    use KnownMemberExpressionParentKind::{Call, Member};
    let mut modifiers = SmallVec::<[usize; 2]>::new();
    for (index, member) in members.iter().enumerate() {
        // What is called is the matcher, and the end of the chain.
        if member.parent_kind == Some(Member) && member.grandparent_kind == Some(Call) {
            return Ok((modifiers, index));
        }
        let is_known = match modifiers.first().and_then(|first| members.get(*first)) {
            None => member.is_any_of(&["not", "resolves", "rejects"]),
            // After `resolves` and `rejects` there can be a `not`.
            Some(first) => {
                modifiers.len() == 1
                    && member.is_name_equal("not")
                    && first.is_any_of(&["resolves", "rejects"])
            }
        };
        if !is_known {
            return Err(ExpectError::ModifierUnknown);
        }
        modifiers.push(index);
    }
    Err(ExpectError::MatcherNotFound)
}

fn is_top_most_call_expr(node: Expr) -> bool {
    let mut at = node;
    while let Some(parent) = parent_expression(at) {
        if parent.tag() == ExprTag::Call {
            return false;
        }
        if !is_member(parent) {
            return true;
        }
        at = parent;
    }
    true
}

/// `VALID_JEST_FN_CALL_CHAINS`: whether a valid chain starts with `name` and the names of `members`, of which the first three count.
fn is_valid_jest_call(name: &[u8], members: &[KnownMemberExpressionProperty]) -> bool {
    let chains: &[&str] = match name {
        b"afterAll" | b"afterEach" | b"beforeAll" | b"beforeEach" | b"bench" => &[""],
        b"describe" => &["each", "only.each", "skip.each"],
        b"fdescribe" | b"xdescribe" => &["each"],
        b"fit" | b"xit" | b"xtest" => &["each", "failing", "fails"],
        b"it" | b"test" => &[
            "concurrent.each",
            "concurrent.only.each",
            "concurrent.skip.each",
            "each",
            "failing",
            "fails",
            "only.each",
            "only.failing",
            "only.fails",
            "skip.each",
            "skip.failing",
            "skip.fails",
            "todo",
        ],
        _ => return false,
    };
    members.is_empty()
        || chains.iter().any(|chain| {
            // oxlint fills a chain up with empty names.
            let valid =
                strings::split(chain.as_bytes(), b".").chain(std::iter::repeat(b"".as_slice()));
            let written = members
                .iter()
                .filter_map(KnownMemberExpressionProperty::name)
                .take(3);
            written.zip(valid).all(|(written, valid)| written == valid)
        })
}

/// `test.todo.only`, ..
fn is_valid_vitest_call(name: &[u8], members: &[KnownMemberExpressionProperty]) -> bool {
    let modifiers = || {
        members
            .iter()
            .filter_map(KnownMemberExpressionProperty::name)
    };
    // `is_test`: there can be an `extend` at the start. For both, an `each` or a `for` at the end.
    let (valid, is_bench, is_test): (&[&str], bool, bool) = match name {
        b"afterAll" | b"afterEach" | b"beforeAll" | b"beforeEach" => {
            return modifiers().next().is_none();
        }
        b"bench" => (&["only", "runIf", "skip", "skipIf", "todo"], true, false),
        b"describe" | b"suite" => (
            &[
                "concurrent",
                "only",
                "runIf",
                "sequential",
                "shuffle",
                "skip",
                "skipIf",
                "todo",
            ],
            false,
            false,
        ),
        b"it" | b"test" => (
            &[
                "concurrent",
                "fails",
                "only",
                "runIf",
                "sequential",
                "skip",
                "skipIf",
                "todo",
            ],
            false,
            true,
        ),
        _ => return false,
    };
    let last = modifiers().count().wrapping_sub(1);
    let mut seen = 0u32;
    modifiers().enumerate().all(|(i, modifier)| match modifier {
        b"each" | b"for" if !is_bench => i == last,
        b"extend" if is_test => i == 0,
        // None twice.
        _ => valid
            .iter()
            .position(|it| it.as_bytes() == modifier)
            .is_some_and(|at| {
                let is_new = seen >> at & 1 == 0;
                seen |= 1 << at;
                is_new
            }),
    })
}

pub(crate) fn is_type_of_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
    kinds: &[JestFnKind],
) -> bool {
    !possible_jest_node
        .kind
        .is_some_and(|it| !kinds.contains(&it))
        && parse_jest_fn_call(file, possible_jest_node).is_some_and(|it| kinds.contains(&it.kind()))
}

pub(crate) fn parse_general_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedGeneralJestFnCall<'a>> {
    if matches!(
        possible_jest_node.kind,
        Some(JestFnKind::Expect | JestFnKind::ExpectTypeOf)
    ) {
        return None;
    }
    match parse_jest_fn_call(file, possible_jest_node)? {
        ParsedJestFnCall::GeneralJest(jest_fn_call) => Some(jest_fn_call),
        _ => None,
    }
}

pub(crate) fn parse_expect_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedExpectFnCall<'a>> {
    if possible_jest_node
        .kind
        .is_some_and(|it| it != JestFnKind::Expect)
    {
        return None;
    }
    match parse_jest_fn_call(file, possible_jest_node)? {
        ParsedJestFnCall::Expect(jest_fn_call) => Some(jest_fn_call),
        _ => None,
    }
}

pub(crate) fn parse_expect_and_typeof_vitest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedExpectFnCall<'a>> {
    if possible_jest_node
        .kind
        .is_some_and(|it| !matches!(it, JestFnKind::Expect | JestFnKind::ExpectTypeOf))
    {
        return None;
    }
    match parse_jest_fn_call(file, possible_jest_node)? {
        ParsedJestFnCall::Expect(jest_fn_call) | ParsedJestFnCall::ExpectTypeOf(jest_fn_call) => {
            Some(jest_fn_call)
        }
        _ => None,
    }
}

// ───────────────────────────── names ─────────────────────────────

/// The names of a chain: `expect` and `toBe` of `expect(foo).toBe(bar)`, `Foo` and `bar` of `new Foo().bar`.
pub(crate) fn get_node_name_vec(expr: Expr<'_>) -> SmallVec<[&[u8]; 4]> {
    let mut chain = SmallVec::new();
    let mut at = expr;
    loop {
        if at.is_parenthesized() || at.is_chain_root() {
            break;
        }
        at = match at.kind() {
            ExprKind::Ident(name) | ExprKind::String(name) => {
                chain.push(name.bytes());
                break;
            }
            ExprKind::Template(template) => {
                chain.extend(template.as_static().map(Name::bytes));
                break;
            }
            ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
                call.callee()
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                chain.extend(static_property_info(at).map(|it| it.1.bytes()));
                obj
            }
            _ => break,
        };
    }
    chain.reverse();
    chain
}

/// [`get_node_name_vec`] with dots.
pub(crate) fn get_node_name(expr: Expr) -> Vec<u8> {
    get_node_name_vec(expr).join(&b"."[..])
}

pub(crate) fn is_equality_matcher(matcher: &KnownMemberExpressionProperty) -> bool {
    matcher.is_any_of(&["toBe", "toEqual", "toStrictEqual"])
}

// ───────────────────────────── what rules are run with ─────────────────────────────

/// Calls `run` with every [`PossibleJestNode`] of the file, as oxlint calls `run_on_jest_node`. It does so in files for which
/// [`is_test`] holds: a rule asks in `register`.
pub(crate) fn run_on_jest_nodes<'a>(
    ctx: &Ctx<'a, '_>,
    run: &dyn Fn(PossibleJestNode<'a>, &Ctx<'a, '_>),
) {
    iter_possible_jest_call_node(ctx.file).for_each(|node| run(node, ctx));
}

/// Whether [`iter_possible_jest_call_node`] can have anything, by what the file mentions. It computes nothing.
pub(crate) fn may_have_possible_jest_call_node(file: &File) -> bool {
    file.mentions_any(&JEST_METHOD_NAMES)
        || file.mentions_any(&[
            "vitest",
            "vite-plus/test",
            "@effect/vitest",
            "@jest/globals",
        ])
}

/// `node.enclosing_function()`, asked of many nodes. A static block is not a function.
#[derive(Default)]
pub(crate) struct EnclosingFunctions<'a>(AncestorMemo<'a, Func<'a>>);

impl<'a> EnclosingFunctions<'a> {
    pub(crate) fn of(&mut self, node: Node<'a>) -> Option<Func<'a>> {
        self.0.find(node, |_, parent| {
            parent
                .as_func()
                .filter(|it| it.kind() != FnKind::StaticBlock)
        })
    }
}

/// The function that encloses `func`.
pub(crate) fn enclosing_function(func: Func<'_>) -> Option<Func<'_>> {
    std::iter::successors(func.enclosing(), |it| it.enclosing())
        .find(|it| it.kind() != FnKind::StaticBlock)
}

/// A node as oxc has it, for what goes up by `ctx.nodes().parent_node(..)` and looks at kinds. It has the levels that are not nodes
/// here: parentheses, the `ChainExpression` around an optional chain, the body of a function. A function expression, an arrow
/// function and a function declaration are the `Expr` or the `Stmt`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum AstKind<'a> {
    Expr(Expr<'a>),
    /// Around this expression.
    ChainExpression(Expr<'a>),
    /// Around this expression, after so many other pairs.
    ParenthesizedExpression(Expr<'a>, u32),
    /// `ExpressionStatement` is a `StmtKind::Expr`.
    Stmt(Stmt<'a>),
    FunctionBody(Func<'a>),
    /// The `Function` of a member of a class.
    Function(Func<'a>),
    Program,
    /// `ObjectProperty`, `VariableDeclarator`, `SwitchCase`, and what no rule asks about.
    Other(Node<'a>),
}

impl<'a> AstKind<'a> {
    pub(crate) fn parent(self) -> AstKind<'a> {
        match self {
            AstKind::Expr(e) if e.is_chain_root() => AstKind::ChainExpression(e),
            AstKind::Expr(e) | AstKind::ChainExpression(e) => AstKind::around(e, 0),
            AstKind::ParenthesizedExpression(e, inner) => AstKind::around(e, inner + 1),
            AstKind::Stmt(statement) => AstKind::of(statement.parent(), true),
            AstKind::FunctionBody(func) => AstKind::of(Node::Func(func), false),
            AstKind::Function(func) => AstKind::of(func.owner(), false),
            AstKind::Other(node) => AstKind::of(node.parent(), false),
            AstKind::Program => AstKind::Program,
        }
    }

    /// What is around `e` and `parens` pairs of parentheses.
    fn around(e: Expr<'a>, parens: u32) -> AstKind<'a> {
        match e.is_parenthesized() && (parens as usize) < e.parens().len() {
            true => AstKind::ParenthesizedExpression(e, parens),
            false => AstKind::of(e.parent(), false),
        }
    }

    /// `is_from_statement`: a function is the parent of the statements of its body.
    fn of(node: Node<'a>, is_from_statement: bool) -> AstKind<'a> {
        match node {
            // All of `a, b, c` is one `SequenceExpression`.
            Node::Expr(e) if e.binary_op() == Some(BinOp::Comma) => {
                AstKind::Expr(utils::sequence_root(e))
            }
            Node::Expr(e) => AstKind::Expr(e),
            Node::Stmt(statement) => AstKind::Stmt(statement),
            Node::File(_) => AstKind::Program,
            Node::Func(func) if is_from_statement => AstKind::FunctionBody(func),
            Node::Func(func) => match func.owner() {
                Node::Expr(e) => AstKind::Expr(e),
                Node::Stmt(statement) => AstKind::Stmt(statement),
                _ => AstKind::Function(func),
            },
            other => AstKind::Other(other),
        }
    }

    /// Its parent, the parent of that, and so on. The last is the `Program`.
    pub(crate) fn ancestors(self) -> impl Iterator<Item = AstKind<'a>> {
        std::iter::successors(Some(self.parent()), |it| {
            (*it != AstKind::Program).then(|| it.parent())
        })
    }

    pub(crate) fn as_expr(self) -> Option<Expr<'a>> {
        match self {
            AstKind::Expr(e) => Some(e),
            _ => None,
        }
    }

    /// The expression that it is, or is around.
    pub(crate) fn innermost_expr(self) -> Option<Expr<'a>> {
        match self {
            AstKind::Expr(e)
            | AstKind::ChainExpression(e)
            | AstKind::ParenthesizedExpression(e, _) => Some(e),
            _ => None,
        }
    }

    pub(crate) fn as_stmt(self) -> Option<Stmt<'a>> {
        match self {
            AstKind::Stmt(statement) => Some(statement),
            _ => None,
        }
    }

    /// `AstKind::CallExpression`
    pub(crate) fn as_call(self) -> Option<Call<'a>> {
        self.as_expr()?.as_call()
    }

    /// `StaticMemberExpression | ComputedMemberExpression | PrivateFieldExpression`
    pub(crate) fn is_member_expression_kind(self) -> bool {
        self.as_expr().is_some_and(|it| {
            matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_jsx_tag_name()
        })
    }

    /// `Function | ArrowFunctionExpression`
    pub(crate) fn as_function(self) -> Option<Func<'a>> {
        match self {
            AstKind::Expr(e) => e.as_fn(),
            AstKind::Stmt(statement) => match statement.kind() {
                StmtKind::Fn(func) => Some(func),
                _ => None,
            },
            AstKind::Function(func) => Some(func).filter(|it| it.kind() != FnKind::StaticBlock),
            _ => None,
        }
    }

    pub(crate) fn span(self) -> Span {
        match self {
            AstKind::Expr(e) | AstKind::ChainExpression(e) => e.span(),
            AstKind::ParenthesizedExpression(e, inner) => {
                e.parens().nth(inner as usize).unwrap_or_else(|| e.span())
            }
            AstKind::Stmt(statement) => statement.span(),
            AstKind::FunctionBody(func) => func.body_span().unwrap_or_default(),
            AstKind::Function(func) => func.span_from_params(),
            AstKind::Program => Span::default(),
            AstKind::Other(node) => node.span(),
        }
    }
}

/// `node.scope_id()`, asked of many nodes: what makes the innermost scope of `oxc_semantic` around a node. `None` is the file.
#[derive(Default)]
pub(crate) struct Scopes<'a>(AncestorMemo<'a, Node<'a>>);

impl<'a> Scopes<'a> {
    pub(crate) fn of(&mut self, node: Node<'a>) -> Option<Node<'a>> {
        self.0.find(node, scope_made_by)
    }
}

/// `{ "max": 5 }`
pub(crate) fn max_of(options: &Options) -> u32 {
    options.object(0).number("max").map_or(5, |it| it as u32)
}

/// `fixer.codegen().print_expression(e)`
pub(crate) fn print_expression(out: &mut Vec<u8>, e: Expr) {
    let mut codegen = Codegen::default();
    bun_lint_oxlint::codegen::print_expression(&mut codegen, e);
    out.append(&mut codegen.code);
}

/// `request.*.expect` is `/^request\.[a-z\d]*\.expect(\.|$)/iu`, and `**` is also for dots. `None` if that is not valid.
pub(crate) fn convert_pattern(pattern: &str) -> Option<Regex> {
    let mut converted = "^".to_owned();
    for (i, part) in strings::split(pattern.as_bytes(), b".").enumerate() {
        converted.push_str(if i > 0 { "\\." } else { "" });
        if part == b"**" {
            converted.push_str("[a-z\\d\\.]*");
            continue;
        }
        for (i, literal) in strings::split(part, b"*").enumerate() {
            converted.push_str(if i > 0 { "[a-z\\d]*" } else { "" });
            converted.push_str(std::str::from_utf8(literal).unwrap_or_default());
        }
    }
    converted.push_str("(\\.|$)");
    rust_regex(&converted, true)
}

// ───────────────────────────── the order of hash tables ─────────────────────────────

/// How oxc hashes the name of an identifier: `IdentHasher`, after `ident_hash`.
fn ident_hash(name: &[u8]) -> u64 {
    const SEED1: u32 = 0x9E37_79B9;
    const SEED2: u32 = 0x85EB_CA6B;
    let byte = |i: usize| name.get(i).map_or(0, |it| u32::from(*it));
    let read_u32 =
        |i: usize| byte(i) | (byte(i + 1) << 8) | (byte(i + 2) << 16) | (byte(i + 3) << 24);
    let mix = |a: u32, b: u32| {
        let m = u64::from(a) * u64::from(b);
        (m as u32) ^ ((m >> 32) as u32)
    };
    let len = name.len();
    let hash = match len {
        0 => 0,
        1..=3 => {
            let packed = (byte(0) << 16) | (byte(len >> 1) << 8) | byte(len - 1);
            mix(packed ^ SEED1, packed ^ SEED2)
        }
        4..=8 => mix(read_u32(0) ^ SEED1, read_u32(len - 4) ^ SEED2),
        9..=16 => mix(
            read_u32(0) ^ read_u32((len >> 1) - 2) ^ SEED1,
            read_u32(len - 4) ^ SEED2,
        ),
        _ => mix(
            read_u32(0) ^ read_u32(len / 3) ^ SEED1,
            read_u32(2 * len / 3) ^ read_u32(len - 4) ^ SEED2,
        ),
    };
    u64::from(hash ^ (len as u32).rotate_left(16)) | (u64::from(hash) << 32)
}

/// The order of `scoping.root_unresolved_references()`, which is a hash table of all the names that the file refers to and does not
/// declare, and with it the order of oxlint's `collect_possible_jest_call_node`.
pub(crate) struct OxlintOrder<'a> {
    /// The place of each name in the table.
    ranks: FxHashMap<Name<'a>, u32>,
}

impl<'a> OxlintOrder<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        // The names, where each is first referred to: they get into the table in this order.
        let mut seen = FxHashSet::default();
        let mut names: Vec<(u32, Name<'a>)> = (file.unresolved_references())
            .filter(|it| seen.insert(it.name()))
            .map(|it| (it.span().start, it.name()))
            .collect();
        // For oxc nothing declares the `arguments` of a function.
        let arguments = file.name_of("arguments");
        if file.mentions("arguments") && !seen.contains(&arguments) {
            let is_arguments =
                |it: &Expr<'a>| it.as_ident() == Some(arguments) && it.symbol().is_none();
            let first = file
                .exprs_of_kind(ExprTag::Ident)
                .filter(is_arguments)
                .map(|it| it.span().start)
                .min();
            names.extend(first.map(|start| (start, arguments)));
            utils::sort::sort_unstable_by_key(&mut names, |it| it.0);
        }
        let mut table = HashOrder::new();
        names
            .iter()
            .for_each(|it| table.insert(ident_hash(it.1.bytes()), it.1));
        OxlintOrder {
            ranks: table.iter().zip(0..).collect(),
        }
    }

    /// The place of `name` in the table.
    pub(crate) fn rank(&self, name: Name<'a>) -> u32 {
        self.ranks.get(&name).copied().unwrap_or(u32::MAX)
    }

    /// What is less for what oxlint has earlier in its list of possible nodes. First what is imported, in the order of the imports,
    /// then the globals, in the order of the table. Of one name the references are in the order of the source, and of one chain the
    /// calls from the inside.
    pub(crate) fn key(&self, possible_jest_node: PossibleJestNode<'a>) -> (bool, u32, u32, u32) {
        let end = possible_jest_node.node.span().end;
        match possible_jest_node.reference {
            Some((reference, u32::MAX)) => (
                true,
                reference.as_ident().map_or(u32::MAX, |it| self.rank(it)),
                reference.span().start,
                end,
            ),
            Some((reference, import_index)) => (false, import_index, reference.span().start, end),
            None => (true, u32::MAX, possible_jest_node.node.span().start, end),
        }
    }
}
