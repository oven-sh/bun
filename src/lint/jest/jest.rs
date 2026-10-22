//! The helpers that oxlint's Jest and Vitest rules are written with, ported to this crate's handles: its
//! `utils/jest.rs`, `utils/jest/parse_jest_fn.rs`, `utils/vitest.rs`, `utils/vitest/valid_vitest_fn.rs`, and the
//! test-related parts of `frameworks.rs`. Each function keeps its oxlint name.
//!
//! - A rule shared by several of `jest`, `vitest` and `bun:test` is one file in `rules/`, generic over `RUNNER`. Its
//!   logic is compiled once, in `jest_*.rs` next to this file: a function there takes a [`Ctx`], which isn't generic
//!   and carries the [`Runner`].
//! - The `jest` and `vitest` rules see what oxlint sees, and oxlint doesn't know about `bun:test`. The `bun:test` rules
//!   only see Bun's functions, and only in a file that imports from `bun:test`. See [`is_for`].
//! - A `CallExpression` is the `Expr` of a `Call`. Text is bytes.
//! - The calls that may be Jest calls are collected once per file, however many rules run. See
//!   [`iter_possible_jest_call_node`].
//! - oxlint recurses along `a.b().c().d..`. Here these are loops.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::source::mention_bit;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    scope_owner, static_property_info, static_property_name, static_string,
};
use bun_lint_oxlint::codegen::Codegen;
use bun_lint_oxlint::hash_order::UnresolvedOrder;
use bun_lint_oxlint::import::{common_js_require, import_entries};
use bun_lint_oxlint::regex_flags::rust_regex;
use smallvec::SmallVec;
use std::cell::OnceCell;

/// The context that a function shared by several rules gets from the rule it runs for:
/// `Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) }`.
pub(crate) struct Ctx<'a, 'r> {
    pub(crate) file: &'a File<'a>,
    pub(crate) runner: Runner,
    pub(crate) report: &'r dyn Fn(Span, Message) -> Report<'a>,
}

/// Call this before reporting from a rule that oxlint runs on Jest calls. See [`File::jest_calls_in_oxlint_order`].
#[inline]
pub(crate) fn note_turns<'a>(file: &'a File<'a>, runner: Runner) {
    if file.language().is_oxlint {
        file.jest_calls_in_oxlint_order(|| OxlintOrder::turns(file, runner));
    }
}

impl<'a> Ctx<'a, '_> {
    pub(crate) fn report(&self, at: impl Spanned, message: Message) -> Report<'a> {
        note_turns(self.file, self.runner);
        (self.report)(at.span(), message)
    }

    /// Adds the fix of a rule with [`meta_with_risky_fix`]. `message` is the suggestion's message.
    pub(crate) fn risky_fix(&self, report: Report<'a>, message: Message, at: Span, text: String) {
        match self.runner {
            Runner::Jest | Runner::Vitest => report.fix(|fixer| fixer.replace(at, text)),
            Runner::Bun => {
                let code_text = text.clone();
                report.suggest_with(message, &[("code", code_text.as_bytes())], |fixer| {
                    fixer.replace(at, text)
                })
            }
        };
    }

    /// The same for a text that's expensive to build. The suggestion has the same message as the report.
    pub(crate) fn risky_fix_with(
        &self,
        report: Report<'a>,
        message: Message,
        fix: impl FnOnce(Fixer<'a>) -> Fix,
    ) {
        match self.runner {
            Runner::Jest | Runner::Vitest => report.fix(fix),
            Runner::Bun => report.suggest(message, fix),
        };
    }

    /// True if a fix may write `name` at `at`, because `name` refers to the runner's function there. For Jest and
    /// Vitest it can be a global, an import, or a top-level `require`. For `bun:test` it has to be an import or a
    /// `require`, because `bun test` only declares `it` and the other globals in files that don't import from
    /// `bun:test`.
    pub(crate) fn can_write(&self, name: &[u8], at: Expr<'a>) -> bool {
        let is_bun = self.runner == Runner::Bun;
        let Some(symbol) = Node::Expr(at).scope().resolve_bytes(name) else {
            return !is_bun;
        };
        let is_runner_module = |source: &[u8]| match is_bun {
            true => source == BUN_TEST,
            false => source == b"@jest/globals" || is_vitest_import_source(source),
        };
        let is_required = || {
            let properties = top_level_requires(self.file).filter_map(|(pattern, source)| {
                match pattern.kind() {
                    PatKind::Object(properties) if is_runner_module(source.bytes()) => {
                        Some(properties)
                    }
                    _ => None,
                }
            });
            properties.flatten().any(|it| {
                it.value().symbol() == Some(symbol)
                    && (it.key().and_then(|it| it.name())).is_some_and(|it| it.bytes() == name)
            })
        };
        symbol.declarations().all(|it| match it {
            Declaration::ImportSpec(it) => {
                it.imported().bytes() == name
                    && is_runner_module(it.import().spec().bytes())
                    && !it.is_type_only()
                    && !it.import().is_type_only()
            }
            Declaration::Var(_) => is_required(),
            _ => false,
        })
    }

    /// True if a fix may change a title. A snapshot stored in a separate file is looked up by the titles.
    pub(crate) fn can_change_titles(&self) -> bool {
        self.runner != Runner::Bun
            || !mentions_any(
                self.file,
                &const { mention_bits(["toMatchSnapshot", "toThrowErrorMatchingSnapshot"]) },
            )
    }
}

/// The `RUNNER` values for `jest`, `vitest` and `bun:test` rules.
pub(crate) const JEST: u8 = 0;
pub(crate) const VITEST: u8 = 1;
pub(crate) const BUN: u8 = 2;

/// The test runner a rule is for.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Runner {
    Jest,
    Vitest,
    Bun,
}

impl Runner {
    /// `runner` is a rule's `RUNNER`.
    pub(crate) const fn of(runner: u8) -> Runner {
        match runner {
            JEST => Runner::Jest,
            VITEST => Runner::Vitest,
            BUN => Runner::Bun,
            _ => panic!("invalid RUNNER"),
        }
    }
}

/// The `Meta` of a rule with `RUNNER`. A `bun:test` rule is Bun's own, so it's available under every kind of config.
pub(crate) const fn meta(runner: u8, name: &'static str, kind: Kind) -> Meta {
    match Runner::of(runner) {
        Runner::Jest => Meta::oxlint(Plugin::Jest, name, kind),
        Runner::Vitest => Meta::oxlint(Plugin::Vitest, name, kind),
        Runner::Bun => Meta::plugin(Plugin::BunTest, name, kind),
    }
}

/// The same for a rule whose fix can make a passing test fail. oxlint applies it as a fix. For `bun:test` it's a
/// suggestion.
pub(crate) const fn meta_with_risky_fix(runner: u8, name: &'static str, kind: Kind) -> Meta {
    match Runner::of(runner) {
        Runner::Jest | Runner::Vitest => meta(runner, name, kind).fixable(Fixable::Code),
        Runner::Bun => meta(runner, name, kind).has_suggestions(),
    }
}

/// Returns the [`mention_bit`] of each of `names`. For use in a constant.
pub(crate) const fn mention_bits<const N: usize>(names: [&str; N]) -> [u32; N] {
    let (mut bits, mut i) = ([0; N], 0);
    while i < N {
        bits[i] = mention_bit(names[i].as_bytes());
        i += 1;
    }
    bits
}

/// `file.mentions_any(..)` of the names with these [`mention_bits`].
pub(crate) fn mentions_any(file: &File, bits: &[u32]) -> bool {
    bits.iter().any(|bit| file.mentions_bit(*bit))
}

pub(crate) const JEST_METHOD_NAMES: [&str; 19] = [
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
const JEST_METHOD_BITS: [u32; 19] = mention_bits(JEST_METHOD_NAMES);
/// The modules that test functions are imported from.
const SOURCE_BITS: [u32; 4] = mention_bits([
    "vitest",
    "vite-plus/test",
    "@effect/vitest",
    "@jest/globals",
]);
const BUN_TEST: &[u8] = b"bun:test";
const BUN_MODIFIERS: [&str; 13] = [
    "concurrent",
    "concurrentIf",
    "each",
    "failing",
    "failingIf",
    "if",
    "only",
    "serial",
    "serialIf",
    "skip",
    "skipIf",
    "todo",
    "todoIf",
];
/// The globals that `bun test` declares in a test file that doesn't import them.
const BUN_GLOBALS: [&str; 14] = [
    "afterAll",
    "afterEach",
    "beforeAll",
    "beforeEach",
    "describe",
    "expect",
    "expectTypeOf",
    "it",
    "jest",
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
            _ if !(2..=12).contains(&name.len()) => JestFnKind::Unknown,
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

// ───────────────────────────── per-file caches ─────────────────────────────

/// Facts computed once per file. It's stored with the file, so it can't hold handles.
struct PerFile {
    /// `ctx.frameworks().is_jest()`: the file is named like a test, or imports something from `@jest/globals`.
    is_jest: bool,
    is_vitest: bool,
    /// The file imports something from `bun:test`.
    is_bun: bool,
    /// The IDs of the identifiers named like one of [`JEST_METHOD_NAMES`], whatever they refer to.
    named_like_jest: OnceCell<Vec<u32>>,
    /// One for the `jest` and `vitest` rules, and one for the `bun:test` rules.
    per_runner: [PerRunner; 2],
}

/// The caches that depend on the runner.
#[derive(Default)]
struct PerRunner {
    /// [`tests_by_name`]
    tests_by_name: OnceCell<Vec<Span>>,
    possible_jest_nodes: OnceCell<PossibleJestNodes>,
}

/// The runners whose tables of valid calls apply.
#[derive(Copy, Clone)]
struct Frameworks {
    is_jest: bool,
    is_vitest: bool,
    is_bun: bool,
}

#[derive(Default)]
struct PossibleJestNodes {
    /// The original names of what's imported from Jest or Vitest, or from `bun:test`.
    originals: Vec<Box<[u8]>>,
    calls: Vec<PossibleCall>,
    /// The [`Scopes::of`] result for each of `calls`, computed on first use.
    scopes: OnceCell<Vec<ScopeMaker>>,
}

/// The node that creates a scope, by ID.
#[derive(Copy, Clone)]
enum ScopeMaker {
    File,
    Func(u32),
    Stmt(u32),
    Class(u32),
}

struct PossibleCall {
    span: Span,
    /// The expression's ID.
    id: u32,
    /// The index in `originals`, if there is one.
    original: u32,
    /// The kind of the name that the chain starts with, going by its original name if it's imported.
    kind: JestFnKind,
    /// The ID of the identifier that the chain starts with.
    reference: u32,
    /// Its index among the names that the file imports. `u32::MAX` for a global.
    import_index: u32,
    /// [`is_in_call_or_member`]
    is_in_call_or_member: bool,
    /// Only set for `it(..)`, where that identifier is the callee and isn't `expect`: true if it parses as a Jest call.
    without_members: Option<bool>,
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

/// Not the same as `PerFile::is_jest`: it goes by different file name endings, and ignores imports.
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

/// `None` only if the file's extension slots are taken by other types.
fn per_file<'a>(file: &'a File<'a>) -> Option<&'a PerFile> {
    file.extension(|| {
        let imports_tests = mentions_any(file, &SOURCE_BITS);
        let imports = |is_source: fn(&[u8]) -> bool| {
            imports_tests && import_entries(file).any(|it| is_source(it.declaration.spec().bytes()))
        };
        PerFile {
            is_jest: is_jestlike_file(file.path()) || imports(|source| source == b"@jest/globals"),
            is_vitest: imports(is_vitest_import_source),
            is_bun: file.mentions_bit(const { mention_bit(BUN_TEST) }) && imports_bun_test(file),
            named_like_jest: OnceCell::new(),
            per_runner: Default::default(),
        }
    })
}

/// Returns the pattern and the module specifier: `{ test: t }` and `a` for `const { test: t } = require("a")` or
/// `.. = await import("a")`.
fn require_binding(declarator: VarDecl<'_>) -> Option<(Pat<'_>, Name<'_>)> {
    let init = declarator.init()?;
    let source = match init.kind() {
        ExprKind::Call(call) => common_js_require(call),
        ExprKind::Await(import) => match import.kind() {
            ExprKind::ImportCall { args } => args.first(),
            _ => None,
        },
        _ => None,
    };
    Some((declarator.pat(), static_string(source?)?))
}

/// Runs [`require_binding`] on every top-level variable declaration.
fn top_level_requires<'a>(file: &'a File<'a>) -> impl Iterator<Item = (Pat<'a>, Name<'a>)> {
    let declarators = file.body().iter().filter_map(Stmt::as_var).flatten();
    declarators.filter_map(require_binding)
}

fn top_level_requires_of_bun_test<'a>(file: &'a File<'a>) -> impl Iterator<Item = Pat<'a>> {
    top_level_requires(file)
        .filter_map(|(pattern, source)| (source.bytes() == BUN_TEST).then_some(pattern))
}

fn imports_bun_test<'a>(file: &'a File<'a>) -> bool {
    let imports = |it: Import| it.spec().bytes() == BUN_TEST && !it.is_type_only();
    file.body().iter().filter_map(Stmt::as_import).any(imports)
        || top_level_requires_of_bun_test(file).next().is_some()
}

impl PerFile {
    fn per_runner(&self, runner: Runner) -> &PerRunner {
        &self.per_runner[usize::from(runner == Runner::Bun)]
    }

    fn frameworks(&self, runner: Runner) -> Frameworks {
        let is_bun = runner == Runner::Bun;
        Frameworks {
            is_jest: self.is_jest && !is_bun,
            is_vitest: self.is_vitest && !is_bun,
            is_bun,
        }
    }
}

/// True if a rule with `RUNNER` applies to `file` at all. A `bun:test` rule only applies to a file that imports from
/// `bun:test`.
#[inline(always)]
pub(crate) fn is_for<'a>(file: &'a File<'a>, runner: u8) -> bool {
    runner != BUN || is_bun(file)
}

fn is_bun<'a>(file: &'a File<'a>) -> bool {
    file.mentions_bit(const { mention_bit(BUN_TEST) }) && per_file(file).is_some_and(|it| it.is_bun)
}

fn is_jest_or_vitest<'a>(file: &'a File<'a>) -> bool {
    per_file(file).is_some_and(|it| it.is_jest || it.is_vitest)
}

/// `ctx.frameworks().is_vitest()`: the file imports something from Vitest. Its name doesn't matter.
pub(crate) fn is_vitest<'a>(file: &'a File<'a>, runner: Runner) -> bool {
    per_file(file).is_some_and(|it| it.frameworks(runner).is_vitest)
}

/// `ctx.frameworks().is_test()`: in other files oxlint doesn't call `run_on_jest_node`. `runner` is the rule's
/// `RUNNER`.
#[inline(always)]
pub(crate) fn is_test<'a>(file: &'a File<'a>, runner: u8) -> bool {
    match runner {
        BUN => is_bun(file),
        _ => is_jest_or_vitest(file),
    }
}

/// A call that may be a Jest call.
#[derive(Copy, Clone)]
pub(crate) struct PossibleJestNode<'a> {
    /// A `Call`.
    pub(crate) node: Expr<'a>,
    /// The callee's name in `@jest/globals`, Vitest or `bun:test`, if it's imported by name from there.
    pub(crate) original: Option<&'a [u8]>,
    /// The runner whose rules it was collected for.
    runner: Runner,
    /// The cached facts, for a node from [`iter_possible_jest_call_node`]. Most rules only care about `expect`, or
    /// don't care about it, so they can skip parsing the other calls.
    cached: Option<&'a PossibleCall>,
}

impl<'a> PossibleJestNode<'a> {
    /// For a call that's only judged by its syntax.
    pub(crate) fn new(node: Expr<'a>, runner: Runner) -> Self {
        PossibleJestNode {
            node,
            original: None,
            runner,
            cached: None,
        }
    }

    fn of(
        file: &'a File<'a>,
        runner: Runner,
        originals: &'a [Box<[u8]>],
        call: &'a PossibleCall,
    ) -> Self {
        PossibleJestNode {
            node: Expr::from_raw(file, call.id),
            original: originals.get(call.original as usize).map(|it| &**it),
            runner,
            cached: Some(call),
        }
    }

    /// Returns [`JestFnKind::from`] for the name that the chain starts with, or `None` if it doesn't start with a name,
    /// in which case it doesn't parse.
    fn kind(&self) -> Option<JestFnKind> {
        match self.cached {
            Some(cached) => Some(cached.kind),
            None => {
                let local = first_identifier_of_chain(self.node.as_call()?.callee())?;
                Some(JestFnKind::from(
                    self.original.unwrap_or_else(|| local.bytes()),
                ))
            }
        }
    }
}

fn possible_jest_nodes<'a>(file: &'a File<'a>, runner: Runner) -> Option<&'a PossibleJestNodes> {
    per_file(file).map(|it| {
        (it.per_runner(runner).possible_jest_nodes)
            .get_or_init(|| collect_possible_jest_call_node(file, it, runner))
    })
}

/// Returns every call to a Jest global, to anything imported from Jest or Vitest, and to anything those calls and their
/// members return: for `expect(1).toBe(1)`, both `expect(1).toBe(1)` and `expect(1)`. For [`Runner::Bun`] it's the
/// globals that `bun test` declares and the imports from `bun:test`.
///
/// The calls are in source order, an outer call before the calls inside it. oxlint has them in a different order, and
/// most rules that depend on the order sort them like this. The others use [`OxlintOrder`]. This is also the port of
/// oxlint's `collect_possible_jest_call_node`.
pub(crate) fn iter_possible_jest_call_node<'a>(
    file: &'a File<'a>,
    runner: Runner,
) -> impl Iterator<Item = PossibleJestNode<'a>> {
    let (originals, calls) = possible_jest_nodes(file, runner)
        .map_or((&[][..], &[][..]), |it| (&it.originals[..], &it.calls[..]));
    calls
        .iter()
        .map(move |call| PossibleJestNode::of(file, runner, originals, call))
}

/// [`iter_possible_jest_call_node`], each node with its [`Scopes::of`] result.
pub(crate) fn iter_possible_jest_call_node_with_scope<'a>(
    file: &'a File<'a>,
    runner: Runner,
) -> impl Iterator<Item = (PossibleJestNode<'a>, Option<Node<'a>>)> {
    let scopes = possible_jest_nodes(file, runner).map_or(&[][..], |found| {
        found.scopes.get_or_init(|| {
            let mut scopes = Scopes::default();
            let calls = found.calls.iter().map(|it| Expr::from_raw(file, it.id));
            calls
                .map(|it| match scopes.of(Node::Expr(it)) {
                    Some(Node::Func(func)) => ScopeMaker::Func(func.id().0),
                    Some(Node::Stmt(statement)) => ScopeMaker::Stmt(statement.id().0),
                    Some(Node::Class(class)) => ScopeMaker::Class(class.id().0),
                    // Nothing else creates a scope.
                    _ => ScopeMaker::File,
                })
                .collect()
        })
    });
    let scope = move |it: &ScopeMaker| match *it {
        ScopeMaker::File => None,
        ScopeMaker::Func(id) => Some(Node::Func(Func::from_raw(file, id))),
        ScopeMaker::Stmt(id) => Some(Node::Stmt(Stmt::from_raw(file, id))),
        ScopeMaker::Class(id) => Some(Node::Class(Class::from_raw(file, id))),
    };
    iter_possible_jest_call_node(file, runner).zip(scopes.iter().map(scope))
}

/// Returns the [`iter_possible_jest_call_node`] entry for the call `node`.
pub(crate) fn possible_jest_node_of<'a>(
    file: &'a File<'a>,
    runner: Runner,
    node: Expr<'a>,
) -> Option<PossibleJestNode<'a>> {
    let found = possible_jest_nodes(file, runner)?;
    let key = |span: Span| (span.start, std::cmp::Reverse(span.end));
    let call = found.calls.get(
        found
            .calls
            .partition_point(|it| key(it.span) < key(node.span())),
    )?;
    (call.id == node.id().0).then(|| PossibleJestNode::of(file, runner, &found.originals, call))
}

fn collect_possible_jest_call_node<'a>(
    file: &'a File<'a>,
    per_file: &PerFile,
    runner: Runner,
) -> PossibleJestNodes {
    let mut found = PossibleJestNodes::default();
    let frameworks = per_file.frameworks(runner);
    let imports_tests = frameworks.is_bun || mentions_any(file, &SOURCE_BITS);
    for (import_index, entry) in import_entries(file)
        .take_while(|_| imports_tests)
        .enumerate()
    {
        let source = entry.declaration.spec().bytes();
        if match frameworks.is_bun {
            true => source != BUN_TEST,
            false => source != b"@jest/globals" && !is_vitest_import_source(source),
        } {
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
        references.for_each(|it| found.add_calls_of(it, original, import_index as u32, frameworks));
    }
    for property in top_level_requires_of_bun_test(file)
        .take_while(|_| frameworks.is_bun)
        .filter_map(|it| match it.kind() {
            PatKind::Object(properties) => Some(properties),
            _ => None,
        })
        .flatten()
    {
        if let Some(original) = property.key().and_then(|it| it.name())
            && let Some(symbol) = property.value().symbol()
        {
            found.originals.push(original.bytes().into());
            let original = found.originals.len() as u32 - 1;
            let references = symbol.references().filter_map(Reference::expr);
            references.for_each(|it| found.add_calls_of(it, original, 0, frameworks));
        }
    }
    // Only resolve a name if it starts a chain.
    let is_global = |e: &Expr<'a>| {
        parent_expression(*e).is_some_and(|it| {
            matches!(it.tag(), ExprTag::Call | ExprTag::TaggedTemplate) || is_member(it)
        }) && e.symbol().is_none()
            && (!frameworks.is_bun || e.as_ident().is_some_and(|it| it.is_any(&BUN_GLOBALS)))
    };
    (per_file.named_like_jest(file).iter())
        .map(|id| Expr::from_raw(file, *id))
        .filter(is_global)
        .for_each(|it| found.add_calls_of(it, u32::MAX, u32::MAX, frameworks));
    // A test file has hundreds of calls, so sort plain integer keys instead of calling a comparator.
    let keys = found.calls.iter().enumerate();
    let mut keys: Vec<u128> = keys.map(|(at, it)| it.span.sort_key(0, at)).collect();
    keys.sort();
    let mut order: Vec<u32> = keys.iter().map(|&key| key as u32).collect();
    utils::sort::apply_permutation_in_place(&mut found.calls, &mut order);
    found
}

impl PerFile {
    fn named_like_jest<'a>(&self, file: &'a File<'a>) -> &[u32] {
        self.named_like_jest.get_or_init(|| {
            // `test` is also the name of a method.
            let names: SmallVec<[Name; 19]> = (JEST_METHOD_NAMES.iter().zip(JEST_METHOD_BITS))
                .filter(|it| file.mentions_bit(it.1))
                .filter_map(|it| file.find_name(it.0))
                .collect();
            if names.is_empty() {
                return Vec::new();
            }
            // One bit per name, which filters out nearly every other identifier.
            let bit = |name: Name| 1u64 << (name.atom().0 % 64);
            let bits = names.iter().fold(0, |bits, name| bits | bit(*name));
            file.exprs_of_kind(ExprTag::Ident)
                .filter(|it| {
                    it.as_ident()
                        .is_some_and(|name| bits & bit(name) != 0 && names.contains(&name))
                })
                .map(|it| it.id().0)
                .collect()
        })
    }
}

/// Calls `visit` with every call that looks like one of `kinds`: the callee's [`first_identifier_of_chain`] is such a
/// name, whatever it refers to.
pub(crate) fn for_each_call_named_like<'a>(
    file: &'a File<'a>,
    kinds: &[JestGeneralFnKind],
    visit: &mut dyn FnMut(Expr<'a>),
) {
    let identifiers = per_file(file).map_or(&[][..], |it| it.named_like_jest(file));
    for identifier in identifiers.iter().map(|id| Expr::from_raw(file, *id)) {
        let kind = identifier.as_ident().map(|it| JestFnKind::from(it.bytes()));
        if !matches!(kind, Some(JestFnKind::General(kind)) if kinds.contains(&kind)) {
            continue;
        }
        let mut at = identifier;
        while !at.is_parenthesized()
            && let Node::Expr(parent) = at.parent()
            && match parent.tag() {
                ExprTag::Dot | ExprTag::Index => parent.object() == Some(at),
                ExprTag::Call | ExprTag::TaggedTemplate => {
                    parent.as_call_like().is_some_and(|it| it.callee() == at)
                }
                _ => false,
            }
        {
            if parent.tag() == ExprTag::Call {
                visit(parent);
            }
            at = parent;
        }
    }
}

/// Calls that look like tests by name, whatever `it` and `test` actually refer to. Only the outermost ones, in source order.
/// For `bun:test` each span is the test's callback, so `a || b` in `test.skipIf(a || b)(..)` isn't a condition in the test.
pub(crate) fn tests_by_name<'a>(file: &'a File<'a>, runner: Runner) -> &'a [Span] {
    let find = || {
        let mut tests: Vec<Span> = Vec::new();
        for_each_call_named_like(file, &[JestGeneralFnKind::Test], &mut |call_expr| {
            if is_type_of_jest_fn_call(
                file,
                PossibleJestNode::new(call_expr, runner),
                &[JestFnKind::General(JestGeneralFnKind::Test)],
            ) {
                tests.extend(match runner {
                    Runner::Jest | Runner::Vitest => Some(call_expr.span()),
                    Runner::Bun => (call_expr.as_call())
                        .and_then(|it| Arguments::of(it.args(), runner).callback)
                        .filter(|it| it.tag() == ExprTag::Fn)
                        .map(|it| it.span()),
                });
            }
        });
        utils::sort::sort_unstable_by_key(&mut tests, |it| (it.start, std::cmp::Reverse(it.end)));
        let mut end = 0;
        tests.retain(|it| {
            let is_outermost = it.end > end;
            end = end.max(it.end);
            is_outermost
        });
        tests
    };
    per_file(file).map_or(&[][..], |it| {
        it.per_runner(runner).tests_by_name.get_or_init(find)
    })
}

impl PossibleJestNodes {
    /// Adds the calls in the longest chain of calls, members and tagged templates that starts with `reference`.
    fn add_calls_of(
        &mut self,
        reference: Expr,
        original: u32,
        import_index: u32,
        frameworks: Frameworks,
    ) {
        let local = reference.as_ident().map_or(b"".as_slice(), Name::bytes);
        let name = self
            .originals
            .get(original as usize)
            .map_or(local, |it| &**it);
        let mut kind = JestFnKind::from(name);
        let is_valid = local != b"each"
            && match kind {
                JestFnKind::General(JestGeneralFnKind::Jest | JestGeneralFnKind::Vitest) => true,
                _ => is_valid_call(frameworks, name, &[]),
            };
        let is_expect = matches!(kind, JestFnKind::Expect | JestFnKind::ExpectTypeOf);
        let mut at = reference;
        while let Some(parent) = parent_expression(at) {
            match parent.tag() {
                ExprTag::Call if parent.callee() == Some(at) => {
                    let is_in_call_or_member = is_in_call_or_member(parent);
                    self.calls.push(PossibleCall {
                        span: parent.span(),
                        id: parent.id().0,
                        original,
                        kind,
                        reference: reference.id().0,
                        import_index,
                        is_in_call_or_member,
                        without_members: (at == reference && !is_expect)
                            .then_some(is_valid && !is_in_call_or_member),
                    });
                }
                ExprTag::Dot if !parent.is_private_member() => {}
                // When the chain continues from the `b` of `a[b]`, oxlint goes by the `a`, unless `b` is imported by
                // name.
                ExprTag::Index
                    if parent.object() != Some(at)
                        && !frameworks.is_bun
                        && original as usize >= self.originals.len() =>
                {
                    let first = first_identifier_of_chain(parent);
                    kind = first.map_or(kind, |it| JestFnKind::from(it.bytes()));
                }
                ExprTag::Index | ExprTag::TaggedTemplate => {}
                _ => return,
            }
            at = parent;
        }
    }
}

/// Returns `e`'s parent expression, or `None` where oxc has a node in between: parentheses, or the `ChainExpression`
/// around an optional chain.
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

// ───────────────────────────── call parser ─────────────────────────────

pub(crate) type Members<'a> = SmallVec<[KnownMemberExpressionProperty<'a>; 2]>;

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
    /// The `it`, under its original name if it's imported.
    pub(crate) name: &'a [u8],
}

pub(crate) struct ParsedExpectFnCall<'a> {
    pub(crate) kind: JestFnKind,
    pub(crate) members: Members<'a>,
    pub(crate) name: &'a [u8],
    /// The name used in the file.
    pub(crate) local: &'a [u8],
    /// The `expect`.
    pub(crate) head: KnownMemberExpressionProperty<'a>,
    /// The arguments of the parsed call: the `2` of `expect(1).toBe(2)`, the `1` of `expect(1)`.
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

    /// Returns the name and the closing text for a fix that reprints `expect(a)`. oxlint's fixes always print `expect`
    /// and `)`. For Bun it's the name used in the file, and everything after the first argument: the `, "why")` of
    /// `expect(a, "why")`.
    pub(crate) fn expect_prefix_and_suffix(&self, runner: Runner) -> (&'a [u8], &'a [u8]) {
        let call_and_argument = (self.head.parent.filter(|_| runner == Runner::Bun))
            .zip(self.expect_arguments.and_then(List::first));
        match call_and_argument {
            Some((call, first)) => {
                let rest = Span::new(first.outer_span().end, call.span().end);
                (self.local, call.file().slice(rest))
            }
            None => (b"expect", b")"),
        }
    }

    /// In source order.
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

/// A link of the chain: the identifier it starts with, or a member's name.
#[derive(Copy, Clone)]
pub(crate) struct KnownMemberExpressionProperty<'a> {
    pub(crate) element: MemberExpressionElement<'a>,
    /// For a member's name, the `Dot` or the `Index`.
    pub(crate) parent: Option<Expr<'a>>,
    pub(crate) parent_kind: Option<KnownMemberExpressionParentKind>,
    pub(crate) grandparent_kind: Option<KnownMemberExpressionParentKind>,
    /// The span of the name, including its quotes.
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
            MemberExpressionElement::Expression(e) => {
                (e.as_ident()).or_else(|| static_string(e)).map(Name::bytes)
            }
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

/// `get_node_chain`, after `resolve_first_ident`: returns the identifier that `callee` starts with, and the members'
/// names in source order. Returns `None` if it starts with anything else, or if the chain has anything but members,
/// calls and tagged templates. oxlint skips the `[b]` of `a[b].c`. With `requires_static_names`, that returns `None`
/// too.
fn get_node_chain(
    callee: Expr<'_>,
    requires_static_names: bool,
) -> Option<(KnownMemberExpressionProperty<'_>, Members<'_>)> {
    use KnownMemberExpressionParentKind::{Call, Member, TaggedTemplate};
    let mut chain = Members::new();
    let (mut at, mut parent) = (callee, None);
    let (mut parent_kind, mut grandparent_kind) = (Some(Call), None);
    loop {
        if at.is_parenthesized() {
            return None;
        }
        let (next, kind) = match at.tag() {
            ExprTag::Ident => {
                let head = KnownMemberExpressionProperty {
                    element: MemberExpressionElement::Expression(at),
                    parent,
                    parent_kind,
                    grandparent_kind,
                    span: at.span(),
                };
                chain.reverse();
                return Some((head, chain));
            }
            ExprTag::Dot => {
                let (obj, name, _) = at.as_dot()?;
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
            ExprTag::Index => {
                let (obj, index, _) = at.as_index()?;
                if let Some((span, _)) = static_property_info(at) {
                    chain.push(KnownMemberExpressionProperty {
                        element: MemberExpressionElement::Expression(index),
                        parent: Some(at),
                        parent_kind: Some(Member),
                        grandparent_kind: parent_kind,
                        span,
                    });
                } else if requires_static_names {
                    return None;
                }
                (obj, Member)
            }
            ExprTag::Call => (at.as_call()?.callee(), Call),
            ExprTag::TaggedTemplate => (at.as_tagged_template()?.callee(), TaggedTemplate),
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

/// Returns the identifier that [`get_node_chain`] of `callee` starts with, or `None` where that returns `None`.
pub(crate) fn first_identifier_of_chain(callee: Expr<'_>) -> Option<Name<'_>> {
    let mut at = callee;
    while !at.is_parenthesized() {
        at = match at.tag() {
            ExprTag::Ident => return at.as_ident(),
            ExprTag::Dot | ExprTag::Index => at.object()?,
            ExprTag::Call | ExprTag::TaggedTemplate => at.as_call_like()?.callee(),
            _ => return None,
        };
    }
    None
}

/// True if `name.a.b(..)` is a valid call for Jest, Vitest or Bun, whichever the file uses. In a file that uses none of
/// them, every call is valid.
fn is_valid_call(
    frameworks: Frameworks,
    name: &[u8],
    members: &[KnownMemberExpressionProperty],
) -> bool {
    let Frameworks {
        is_jest,
        is_vitest,
        is_bun,
    } = frameworks;
    !is_jest && !is_vitest && !is_bun
        || is_jest && is_valid_jest_call(name, members)
        || is_vitest && is_valid_vitest_call(name, members)
        || is_bun && is_valid_bun_call(name, members)
}

/// Parses the call `call_expr`. The parent checks use `possible_jest_node`'s node, because some rules pass a node other
/// than the call.
pub(crate) fn parse_jest_fn_call_in<'a>(
    file: &'a File<'a>,
    call_expr: Expr<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedJestFnCall<'a>> {
    let PossibleJestNode {
        node,
        original,
        runner,
        ..
    } = possible_jest_node;
    let cached = possible_jest_node
        .cached
        .filter(|it| it.id == call_expr.id().0);
    let call_expr = call_expr.as_call()?;
    let callee = call_expr.callee();
    let is_nested_in_chain =
        || cached.map_or_else(|| is_in_call_or_member(node), |it| it.is_in_call_or_member);

    // `it(..)`, `expect(..)`
    if let Some(local) = callee.as_ident()
        && !callee.is_parenthesized()
    {
        let local = local.bytes();
        let name = original.unwrap_or(local);
        if local == b"each" {
            return None;
        }
        let kind = cached.map_or_else(|| JestFnKind::from(name), |it| it.kind);
        if matches!(kind, JestFnKind::Expect | JestFnKind::ExpectTypeOf) {
            let head = KnownMemberExpressionProperty {
                element: MemberExpressionElement::Expression(callee),
                parent: None,
                parent_kind: Some(KnownMemberExpressionParentKind::Call),
                grandparent_kind: None,
                span: callee.span(),
            };
            let members = Members::new();
            return parse_jest_expect_fn_call(
                node, call_expr, members, name, local, head, kind, runner,
            );
        }
        let is_valid = || match kind {
            JestFnKind::General(JestGeneralFnKind::Jest | JestGeneralFnKind::Vitest) => true,
            _ => per_file(file).is_none_or(|it| is_valid_call(it.frameworks(runner), name, &[])),
        };
        let is_call = match cached.and_then(|it| it.without_members) {
            Some(is_call) => is_call,
            None => !is_nested_in_chain() && is_valid(),
        };
        return is_call.then(|| {
            ParsedJestFnCall::GeneralJest(ParsedGeneralJestFnCall {
                kind,
                members: Members::new(),
                name,
            })
        });
    }

    let (head, members) = get_node_chain(callee, runner == Runner::Bun)?;
    let local = head.name()?;
    let name = original.unwrap_or(local);
    let last = members.last().unwrap_or(&head);
    let is_each = last.is_name_equal("each");
    // `test.skipIf(a)`
    let is_condition =
        runner == Runner::Bun && (last.name()).is_some_and(|it| it == b"if" || it.ends_with(b"If"));

    // `.each()` is parsed together with the call to its result: `.each()()`.
    if (is_each || is_condition) && !matches!(callee.tag(), ExprTag::Call | ExprTag::TaggedTemplate)
    {
        return None;
    }
    if !is_each && callee.tag() == ExprTag::TaggedTemplate {
        return None;
    }

    let kind = JestFnKind::from(name);
    if matches!(kind, JestFnKind::Expect | JestFnKind::ExpectTypeOf) {
        return parse_jest_expect_fn_call(
            node, call_expr, members, name, local, head, kind, runner,
        );
    }

    // Only the whole of `x().y.z()` is a Jest call, not the `x()`.
    if is_nested_in_chain() {
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

    // All links but the last have to be members: nothing before the last is called.
    if !members.is_empty() && head.parent_kind != Some(KnownMemberExpressionParentKind::Member) {
        return None;
    }

    if let Some(frameworks) = per_file(file).map(|it| it.frameworks(runner)) {
        if !is_valid_call(frameworks, name, &members) {
            return None;
        }
        if frameworks.is_vitest
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
    runner: Runner,
) -> Option<ParsedJestFnCall<'a>> {
    let (modifier_indices, matcher_index, mut expect_error) =
        match find_modifiers_and_matcher(&members, runner) {
            Ok((modifiers, matcher)) => (modifiers, Some(matcher), None),
            Err(error) => (SmallVec::new(), None, Some(error)),
        };

    // For an invalid chain, only the topmost call is reported.
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

/// Returns the indices of the modifiers and of the matcher.
fn find_modifiers_and_matcher(
    members: &[KnownMemberExpressionProperty],
    runner: Runner,
) -> Result<(SmallVec<[usize; 2]>, usize), ExpectError> {
    use KnownMemberExpressionParentKind::{Call, Member};
    let mut modifiers = SmallVec::<[usize; 2]>::new();
    for (index, member) in members.iter().enumerate() {
        // The member that's called is the matcher, and it ends the chain.
        if member.parent_kind == Some(Member) && member.grandparent_kind == Some(Call) {
            return Ok((modifiers, index));
        }
        let is_known = match modifiers.first().and_then(|first| members.get(*first)) {
            // Bun allows them in any order, and more than once. The last two are properties of `expect` itself:
            // `expect.resolvesTo.stringContaining("a")`.
            _ if runner == Runner::Bun => {
                member.is_any_of(&["not", "resolves", "rejects", "resolvesTo", "rejectsTo"])
            }
            None => member.is_any_of(&["not", "resolves", "rejects"]),
            // A `not` can follow `resolves` or `rejects`.
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

/// `VALID_JEST_FN_CALL_CHAINS`: true if a valid chain starts with `name` and the names of `members`. Only the first
/// three members count.
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
            // oxlint pads a chain with empty names.
            let valid =
                strings::split(chain.as_bytes(), b".").chain(std::iter::repeat(b"".as_slice()));
            let actual = members
                .iter()
                .filter_map(KnownMemberExpressionProperty::name)
                .take(3);
            actual.zip(valid).all(|(actual, valid)| actual == valid)
        })
}

/// `test.todo.only`, ..
fn is_valid_vitest_call(name: &[u8], members: &[KnownMemberExpressionProperty]) -> bool {
    let modifiers = || {
        members
            .iter()
            .filter_map(KnownMemberExpressionProperty::name)
    };
    // With `is_test`, the chain can start with `extend`. Unless `is_bench`, it can end with `each` or `for`.
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
        // No modifier may appear twice.
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

/// `test.skipIf(a).each(b)`, ..: every modifier is a property of every other.
fn is_valid_bun_call(name: &[u8], members: &[KnownMemberExpressionProperty]) -> bool {
    match name {
        b"afterAll" | b"afterEach" | b"beforeAll" | b"beforeEach" => members.is_empty(),
        b"describe" | b"it" | b"test" | b"xdescribe" | b"xit" | b"xtest" => {
            members.iter().all(|it| it.is_any_of(&BUN_MODIFIERS))
        }
        _ => false,
    }
}

/// The roles of the arguments of `test(..)`, `describe(..)` and the like. No `bun:test` rule picks an argument by
/// position.
#[derive(Copy, Clone)]
pub(crate) struct Arguments<'a> {
    pub(crate) title: Option<Expr<'a>>,
    pub(crate) callback: Option<Expr<'a>>,
    /// An object, or the timeout.
    pub(crate) options: Option<Expr<'a>>,
}

/// True if an argument is a function, as far as its syntax shows. `None` for a name, a call and so on.
fn is_function(argument: Expr) -> Option<bool> {
    match argument.tag() {
        ExprTag::Fn => Some(true),
        ExprTag::String
        | ExprTag::Template
        | ExprTag::Number
        | ExprTag::BigInt
        | ExprTag::True
        | ExprTag::False
        | ExprTag::Null
        | ExprTag::Regex
        | ExprTag::Object
        | ExprTag::Array => Some(false),
        _ => None,
    }
}

impl<'a> Arguments<'a> {
    /// For Jest and Vitest the title is the first argument and the callback the second, as in oxlint's rules.
    /// `bun test` goes by which argument is a function: `(title, callback, options)`, `(title, options, callback)`,
    /// `(callback, options)`, `(title, callback)`, `(title)`, `(callback)`. Where an argument is just a name, the
    /// arguments that clearly aren't functions decide, then the usual order. A single name counts as the callback.
    pub(crate) fn of(arguments: List<'a, Expr<'a>>, runner: Runner) -> Self {
        let [a, b, c] = [arguments.first(), arguments.get(1), arguments.get(2)];
        let is = |it: Option<Expr>| it.and_then(is_function);
        let (title, callback, options) = match (runner, is(a), is(b), is(c)) {
            (Runner::Jest | Runner::Vitest, ..) => (a, b, None),
            _ if c.is_some() => match (is(b), is(c)) {
                (Some(false), _) | (None, Some(true)) => (a, c, b),
                _ => (a, b, c),
            },
            // `test(callback, 1000)`, `test(() => {}, timeout)`
            (_, Some(true) | None, Some(false), _) | (_, Some(true), None, _) if b.is_some() => {
                (None, a, b)
            }
            _ if b.is_some() => (a, b, None),
            (_, Some(false), ..) => (a, None, None),
            _ => (None, a, None),
        };
        Arguments {
            title,
            callback,
            options,
        }
    }

    /// True if the callback can be a function.
    pub(crate) fn can_have_callback(&self) -> bool {
        self.callback
            .is_some_and(|it| is_function(it) != Some(false))
    }
}

pub(crate) fn is_type_of_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
    kinds: &[JestFnKind],
) -> bool {
    (possible_jest_node.kind()).is_some_and(|it| kinds.contains(&it))
        && match possible_jest_node.cached.and_then(|it| it.without_members) {
            Some(is_call) => is_call,
            None => parse_jest_fn_call(file, possible_jest_node)
                .is_some_and(|it| kinds.contains(&it.kind())),
        }
}

pub(crate) fn parse_general_jest_fn_call<'a>(
    file: &'a File<'a>,
    possible_jest_node: PossibleJestNode<'a>,
) -> Option<ParsedGeneralJestFnCall<'a>> {
    let kind = possible_jest_node.kind()?;
    if matches!(kind, JestFnKind::Expect | JestFnKind::ExpectTypeOf) {
        return None;
    }
    if let Some(is_call) = possible_jest_node.cached.and_then(|it| it.without_members) {
        if !is_call {
            return None;
        }
        return Some(ParsedGeneralJestFnCall {
            kind,
            members: Members::new(),
            name: match possible_jest_node.original {
                Some(original) => original,
                None => possible_jest_node.node.callee()?.as_ident()?.bytes(),
            },
        });
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
    if possible_jest_node.kind()? != JestFnKind::Expect {
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
    if !matches!(
        possible_jest_node.kind()?,
        JestFnKind::Expect | JestFnKind::ExpectTypeOf
    ) {
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

/// Returns the names in a chain: `expect` and `toBe` for `expect(foo).toBe(bar)`, `Foo` and `bar` for `new Foo().bar`.
pub(crate) fn get_node_name_vec(expr: Expr<'_>) -> SmallVec<[&[u8]; 4]> {
    let mut chain = SmallVec::new();
    for_each_node_name_reversed(expr, |name| chain.push(name.bytes()));
    chain.reverse();
    chain
}

/// Returns the first name of [`get_node_name_vec`].
pub(crate) fn get_first_node_name(expr: Expr<'_>) -> Option<Name<'_>> {
    let mut first = None;
    for_each_node_name_reversed(expr, |name| first = Some(name));
    first
}

fn for_each_node_name_reversed<'a>(expr: Expr<'a>, mut visit: impl FnMut(Name<'a>)) {
    let mut at = Some(expr);
    while let Some(link) = at.filter(|it| !it.is_parenthesized() && !it.is_chain_root()) {
        at = match link.tag() {
            ExprTag::Ident => return link.as_ident().into_iter().for_each(visit),
            ExprTag::String | ExprTag::Template => {
                return static_string(link).into_iter().for_each(visit);
            }
            ExprTag::TaggedTemplate | ExprTag::Call | ExprTag::New => {
                link.as_call_like().map(Call::callee)
            }
            ExprTag::Dot | ExprTag::Index => {
                static_property_name(link).into_iter().for_each(&mut visit);
                link.object()
            }
            _ => return,
        };
    }
}

/// [`get_node_name_vec`] joined with dots.
pub(crate) fn get_node_name(expr: Expr) -> Vec<u8> {
    get_node_name_vec(expr).join(&b"."[..])
}

pub(crate) fn is_equality_matcher(matcher: &KnownMemberExpressionProperty) -> bool {
    matcher.is_any_of(&["toBe", "toEqual", "toStrictEqual"])
}

// ───────────────────────────── running rules ─────────────────────────────

/// Calls `run` with every [`PossibleJestNode`] of the file, the way oxlint calls `run_on_jest_node`. oxlint only does
/// that in files where [`is_test`] is true, which a rule checks in `start`.
pub(crate) fn run_on_jest_nodes<'a>(
    ctx: &Ctx<'a, '_>,
    run: &dyn Fn(PossibleJestNode<'a>, &Ctx<'a, '_>),
) {
    iter_possible_jest_call_node(ctx.file, ctx.runner).for_each(|node| run(node, ctx));
}

/// For `bun:test`: calls to the functions in `names` that [`iter_possible_jest_call_node`] doesn't return. Those are the user's
/// own wrappers around `test`. oxlint only compares `additionalTestBlockFunctions` with the names the runner declares.
pub(crate) fn custom_test_block_calls<'a>(
    ctx: &Ctx<'a, '_>,
    names: &[String],
) -> impl Iterator<Item = PossibleJestNode<'a>> {
    let (file, runner) = (ctx.file, ctx.runner);
    file.exprs_of_kind(ExprTag::Call)
        .take_while(move |_| runner == Runner::Bun && !names.is_empty())
        .filter(move |it| {
            let name = it.callee().map(get_node_name).unwrap_or_default();
            names.iter().any(|it| it.as_bytes() == name)
                && !is_in_call_or_member(*it)
                && possible_jest_node_of(file, runner, *it).is_none()
        })
        .map(move |it| PossibleJestNode::new(it, runner))
}

/// Fast check: true if [`iter_possible_jest_call_node`] may return anything, judging by the names the file mentions.
pub(crate) fn may_have_possible_jest_call_node(file: &File) -> bool {
    mentions_jest_method(file) || mentions_any(file, &SOURCE_BITS)
}

/// True if the file mentions a name that defines a test: `it`, `test`, `xit`, ..
pub(crate) fn mentions_test(file: &File) -> bool {
    mentions_any(
        file,
        &const { mention_bits(["test", "it", "fit", "xit", "xtest"]) },
    )
}

/// The same for `describe`.
pub(crate) fn mentions_describe(file: &File) -> bool {
    mentions_any(
        file,
        &const { mention_bits(["describe", "suite", "fdescribe", "xdescribe"]) },
    )
}

/// True if the file mentions one of [`JEST_METHOD_NAMES`].
pub(crate) fn mentions_jest_method(file: &File) -> bool {
    mentions_any(file, &JEST_METHOD_BITS)
}

/// A memo for calling `node.enclosing_function()` on many nodes. A static block isn't a function.
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

pub(crate) fn enclosing_function(func: Func<'_>) -> Option<Func<'_>> {
    std::iter::successors(func.enclosing(), |it| it.enclosing())
        .find(|it| it.kind() != FnKind::StaticBlock)
}

/// A node as oxc models it, for code that walks up with `ctx.nodes().parent_node(..)` and checks kinds. It has the
/// levels that aren't nodes here: parentheses, the `ChainExpression` around an optional chain, and a function's body. A
/// function expression, an arrow function and a function declaration are the `Expr` or the `Stmt`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum AstKind<'a> {
    Expr(Expr<'a>),
    /// Around this expression.
    ChainExpression(Expr<'a>),
    /// Around this expression and this many inner pairs of parentheses.
    ParenthesizedExpression(Expr<'a>, u32),
    /// `ExpressionStatement` is a `StmtKind::Expr`.
    Stmt(Stmt<'a>),
    FunctionBody(Func<'a>),
    /// The `Function` of a class member.
    Function(Func<'a>),
    Program,
    /// `ObjectProperty`, `VariableDeclarator`, `SwitchCase`, and the kinds no rule checks for.
    Other(Node<'a>),
}

impl<'a> AstKind<'a> {
    pub(crate) fn parent(self) -> AstKind<'a> {
        match self {
            AstKind::Expr(e) if e.is_chain_root() => AstKind::ChainExpression(e),
            AstKind::Expr(e) | AstKind::ChainExpression(e) => AstKind::parent_outside_parens(e, 0),
            AstKind::ParenthesizedExpression(e, inner) => {
                AstKind::parent_outside_parens(e, inner + 1)
            }
            AstKind::Stmt(statement) => AstKind::of(statement.parent(), true),
            AstKind::FunctionBody(func) => AstKind::of(Node::Func(func), false),
            AstKind::Function(func) => AstKind::of(func.owner(), false),
            AstKind::Other(node) => AstKind::of(node.parent(), false),
            AstKind::Program => AstKind::Program,
        }
    }

    /// Returns the node around `e` and `parens` pairs of parentheses.
    fn parent_outside_parens(e: Expr<'a>, parens: u32) -> AstKind<'a> {
        match e.is_parenthesized() && (parens as usize) < e.parens().len() {
            true => AstKind::ParenthesizedExpression(e, parens),
            false => AstKind::of(e.parent(), false),
        }
    }

    /// `is_from_statement` is true when coming from a statement, whose parent here is the function itself, not a body
    /// node.
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

    /// Returns its parent, that node's parent, and so on. The last is the `Program`.
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

    /// Returns the expression that it is, or that it wraps.
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

/// A memo for calling `node.scope_id()` on many nodes: returns the node that creates the innermost `oxc_semantic` scope
/// around a node. `None` is the file.
#[derive(Default)]
pub(crate) struct Scopes<'a>(AncestorMemo<'a, Node<'a>>);

impl<'a> Scopes<'a> {
    pub(crate) fn of(&mut self, node: Node<'a>) -> Option<Node<'a>> {
        self.0.find(node, scope_owner)
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

/// Converts `request.*.expect` to `/^request\.[a-z\d]*\.expect(\.|$)/iu`. `**` also matches dots. Returns `None` if the result
/// isn't a valid regex.
///
/// For `bun:test`, stars also match `_` and `$`, and `**` can match nothing: `request.**.expect` matches `request.expect`.
pub(crate) fn convert_pattern(pattern: &str, runner: Runner) -> Option<Regex> {
    let is_bun = runner == Runner::Bun;
    let mut converted = "^".to_owned();
    let mut follows_optional_dot = false;
    for (i, part) in strings::split(pattern.as_bytes(), b".").enumerate() {
        if part == b"**" && is_bun {
            follows_optional_dot = i == 0;
            converted.push_str(if i == 0 {
                "(?:[\\w$.]*\\.)?"
            } else {
                "(?:\\.[\\w$.]*)?"
            });
            continue;
        }
        converted.push_str(if i > 0 && !follows_optional_dot {
            "\\."
        } else {
            ""
        });
        follows_optional_dot = false;
        if part == b"**" {
            converted.push_str("[a-z\\d\\.]*");
            continue;
        }
        for (i, literal) in strings::split(part, b"*").enumerate() {
            converted.push_str(match (i > 0, is_bun) {
                (false, _) => "",
                (true, false) => "[a-z\\d]*",
                (true, true) => "[\\w$]*",
            });
            for (i, plain) in strings::split(literal, b"$").enumerate() {
                converted.push_str(match (i > 0, is_bun) {
                    (false, _) => "",
                    (true, false) => "$",
                    (true, true) => "\\$",
                });
                converted.push_str(std::str::from_utf8(plain).unwrap_or_default());
            }
        }
    }
    converted.push_str("(\\.|$)");
    rust_regex(&converted, true)
}

// ───────────────────────────── hash table order ─────────────────────────────

/// The order of oxlint's `collect_possible_jest_call_node`, which iterates over `scoping.root_unresolved_references()`.
pub(crate) struct OxlintOrder<'a> {
    names: UnresolvedOrder<'a>,
}

impl<'a> OxlintOrder<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        OxlintOrder {
            names: UnresolvedOrder::new(file),
        }
    }

    /// Returns the one of `nodes` that comes first in oxlint's list of possible nodes.
    pub(crate) fn first(
        file: &'a File<'a>,
        nodes: &[PossibleJestNode<'a>],
    ) -> Option<PossibleJestNode<'a>> {
        // The table only orders different names, so it isn't needed if all the nodes are the same global.
        let global = |it: &PossibleJestNode<'a>| {
            let cached = it.cached.filter(|it| it.import_index == u32::MAX)?;
            Expr::from_raw(file, cached.reference).as_ident()
        };
        let name = global(nodes.first()?);
        if name.is_some() && nodes.iter().all(|it| global(it) == name) {
            let key = |it: &PossibleJestNode<'a>| {
                let reference = it.cached.map(|it| Expr::from_raw(file, it.reference));
                (reference.map(|it| it.span().start), it.node.span().end)
            };
            return nodes.iter().copied().min_by_key(key);
        }
        let order = OxlintOrder::new(file);
        nodes.iter().copied().min_by_key(|it| order.key(*it))
    }

    /// Computes the argument for [`File::jest_calls_in_oxlint_order`].
    #[cold]
    fn turns(file: &'a File<'a>, runner: Runner) -> Box<[(Span, u32)]> {
        let order = OxlintOrder::new(file);
        let nodes: Vec<PossibleJestNode<'a>> = iter_possible_jest_call_node(file, runner).collect();
        let mut by_turn: Vec<u32> = (0..nodes.len() as u32).collect();
        utils::sort::sort_by_cached_key(&mut by_turn, |it| {
            nodes.get(*it as usize).map(|it| order.key(*it))
        });
        let mut calls: Box<[(Span, u32)]> = nodes.iter().map(|it| (it.node.span(), 0)).collect();
        for (turn, at) in (0..).zip(by_turn) {
            if let Some(call) = calls.get_mut(at as usize) {
                call.1 = turn;
            }
        }
        calls
    }

    /// Returns the position of `name` in the table.
    pub(crate) fn rank(&self, name: Name<'a>) -> u32 {
        self.names.rank(name)
    }

    /// Returns a sort key that orders nodes like oxlint's list of possible nodes: first the imports, in import order,
    /// then the globals, in table order. References to the same name are in source order, and the calls of one chain go
    /// from the innermost out.
    pub(crate) fn key(&self, possible_jest_node: PossibleJestNode<'a>) -> (bool, u32, u32, u32) {
        let (file, end) = (
            possible_jest_node.node.file(),
            possible_jest_node.node.span().end,
        );
        let reference = possible_jest_node
            .cached
            .map(|it| (Expr::from_raw(file, it.reference), it.import_index));
        match reference {
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
