use crate::bun_aot::{Change, NameSet, builtin_for_expr, key_name, shown};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_import_from_module;

/// Disallow stubs and fake timers that are written in JavaScript and replace what `bun test --aot` makes immutable. `spyOn()` of
/// `bun:test` is part of the test runner, which can replace it.
pub struct AotSpyOnBuiltin;

const SPY: Message = Message::new(
    "spy",
    "This replaces {{property}}, which throws a `TypeError` under `bun test --aot`: built-in objects are immutable there. Use `spyOn()` from `bun:test`.",
);
const CLOCK: Message = Message::new(
    "clock",
    "This replaces {{property}}, which throws a `TypeError` under `bun test --aot`: built-in objects are immutable there. To set the clock, use `setSystemTime()` or `jest.useFakeTimers()` from `bun:test`.",
);
const FAKE_TIMERS: Message = Message::new(
    "fakeTimers",
    "This replaces the global `Date`, which throws a `TypeError` under `bun test --aot`: built-in objects are immutable there. Use `jest.useFakeTimers()` from `bun:test`, or leave `Date` out of `{{option}}`.",
);

/// The packages whose `install()` replaces the timers and `Date`.
const FAKE_TIMERS_PACKAGES: [&str; 2] = ["@sinonjs/fake-timers", "lolex"];

/// Whether the configuration of fake timers has them replace `Date`: all are replaced unless `option` lists some.
/// `None`: it is not to be seen.
fn replaces_date(configuration: Option<Expr>, option: &str) -> Option<bool> {
    let Some(configuration) = configuration.map(Expr::skip_type_wrappers) else {
        return Some(true);
    };
    let properties = match configuration.kind() {
        ExprKind::Object(properties) => properties,
        // The time to start at.
        ExprKind::Number(_) | ExprKind::New(_) | ExprKind::Call(_) => return Some(true),
        _ => return None,
    };
    if properties
        .iter()
        .any(|it| it.kind() == PropKind::Spread || it.key().is_some_and(Key::is_computed))
    {
        return None;
    }
    let Some(listed) = properties
        .iter()
        .find(|it| it.key().is_some_and(|key| key.is(option)))
    else {
        return Some(true);
    };
    let listed = listed.value()?.skip_type_wrappers().as_array()?;
    // For sinon an empty list is no list.
    if listed.is_empty() {
        return Some(option == "toFake");
    }
    let mut names = listed.iter().map(|it| it.skip_type_wrappers().as_string());
    names.try_fold(false, |found, name| {
        Some(found || name?.is_any(&["Date", "Intl"]))
    })
}

impl AotSpyOnBuiltin {
    /// `double(object, "name")`, which defines the property: `stub()` of sinon, `mock.method()` of `node:test`.
    fn check_double<'a>(e: Expr<'a>, call: Call<'a>, cx: &mut Cx<'a, Self>) {
        let (Some(object), Some(key)) = (call.args().first(), call.args().get(1)) else {
            return;
        };
        if let Some(builtin) = builtin_for_expr(object, None)
            && let Some(name) = key_name(key)
            && builtin.has_property(&name)
            && builtin.rejects_change(&name, Change::Define)
        {
            let is_clock = match builtin.name {
                "" => *name == *b"Date",
                "Date" => *name == *b"now",
                _ => false,
            };
            let message = if is_clock { CLOCK } else { SPY };
            cx.report(e, message)
                .data("property", shown(builtin, &name));
        }
    }

    fn check_fake_timers<'a>(
        e: Expr<'a>,
        call: Call<'a>,
        option: &'static str,
        cx: &mut Cx<'a, Self>,
    ) {
        if call.args().len() <= 1 && replaces_date(call.args().first(), option) == Some(true) {
            cx.report(e, FAKE_TIMERS).data("option", option);
        }
    }
}

const DOUBLES: [&str; 8] = [
    "stub",
    "spy",
    "replace",
    "replaceGetter",
    "replaceSetter",
    "method",
    "getter",
    "setter",
];
const ALL_CALLS: On = On::new().exprs(&[ExprTag::Call]);
const NAMED_CALLS: On = On::new()
    .method_calls(&DOUBLES)
    .method_calls(&["useFakeTimers", "install", "enable"]);

#[inline]
fn fake_timer_methods(file: &File) -> [Option<&'static str>; 3] {
    [
        (file.mentions("useFakeTimers") && file.mentions("sinon")).then_some("useFakeTimers"),
        (file.mentions("install") && file.mentions_any(&FAKE_TIMERS_PACKAGES)).then_some("install"),
        (file.mentions("enable") && file.mentions("timers")).then_some("enable"),
    ]
}

pub struct State {
    names: NameSet,
}

impl Rule for AotSpyOnBuiltin {
    const META: Meta = Meta::plugin(Plugin::Bun, "aot-spy-on-builtin", Kind::Problem);
    const ON: On = ALL_CALLS;
    type State<'a> = State;

    fn new(_: &Options) -> Self {
        AotSpyOnBuiltin
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let has_candidates =
            file.mentions_any(&DOUBLES) || fake_timer_methods(file).iter().any(Option::is_some);
        match (has_candidates, file.has_calls_by_name()) {
            (false, _) => On::new(),
            (true, true) => NAMED_CALLS,
            (true, false) => ALL_CALLS,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State> {
        let names = (DOUBLES.into_iter()).chain(fake_timer_methods(file).into_iter().flatten());
        Some(State {
            names: names.filter_map(|it| file.find_name(it)).collect(),
        })
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let callee = call.callee();
        let name = (callee.member_name().map(Ident::name)).or_else(|| callee.as_ident());
        if name.is_some_and(|it| cx.state.names.has(it)) {
            Self::check(e, call, cx);
        }
    }
}

impl AotSpyOnBuiltin {
    #[inline(never)]
    fn check<'a>(e: Expr<'a>, call: Call<'a>, cx: &mut Cx<'a, Self>) {
        let callee = call.callee();
        let Some((object, name, _)) = callee.as_dot() else {
            return;
        };
        match name.bytes() {
            b"stub" | b"spy" | b"method" | b"getter" | b"setter" => {
                Self::check_double(e, call, cx);
            }
            // Not that of a string.
            b"replace" | b"replaceGetter" | b"replaceSetter" if call.args().len() == 3 => {
                Self::check_double(e, call, cx);
            }
            // Those of `jest` and `vi` are Bun's own, and replace nothing.
            b"useFakeTimers"
                if cx.file().mentions("sinon")
                    && !object.is_ident("jest")
                    && !object.is_ident("vi") =>
            {
                Self::check_fake_timers(e, call, "toFake", cx);
            }
            b"install"
                if FAKE_TIMERS_PACKAGES
                    .iter()
                    .any(|it| is_from_package(object, it)) =>
            {
                Self::check_fake_timers(e, call, "toFake", cx);
            }
            // `mock.timers.enable()` of `node:test`
            b"enable"
                if object
                    .member_name()
                    .is_some_and(|it| it.name().is("timers")) =>
            {
                Self::check_fake_timers(e, call, "apis", cx);
            }
            _ => {}
        }
    }
}

/// `import a from "package"`, `const a = require("package")`
fn is_from_package(e: Expr, package: &str) -> bool {
    if !e.file().mentions(package) || e.tag() != ExprTag::Ident {
        return false;
    }
    let is_required = |declaration: Declaration| match declaration.node() {
        Some(Node::VarDecl(variable)) => {
            variable.init().and_then(Expr::as_call).is_some_and(|call| {
                let required = call.args().first().and_then(Expr::as_string);
                call.callee().is_ident("require") && required.is_some_and(|it| it.is(package))
            })
        }
        _ => false,
    };
    is_import_from_module(e, package)
        || e.symbol()
            .is_some_and(|it| it.declarations().any(is_required))
}
