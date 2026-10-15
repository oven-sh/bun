use crate::bun_aot::{Builtin, Change, NameSet, builtin_named_by, key_name, shown};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{is_global_reference, is_import_from_module};

/// Disallow spies, stubs and fake timers that replace what `bun test --aot` makes immutable.
pub struct AotSpyOnBuiltin;

const SPY: Message = Message::new(
    "spy",
    "This replaces {{property}}, which throws a `TypeError` under `bun test --aot`: built-in objects are immutable there. Spy on a function of your own that calls it.",
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

/// How a function puts something else in the place of a property.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Double {
    /// `spyOn()` of `bun:test`, which does not go by the rules of JavaScript.
    Native,
    /// `Object.defineProperty()`: `stub()` of sinon, `mock.method()` of `node:test`.
    Defined,
}

impl Double {
    fn is_refused(self, builtin: &Builtin, name: &[u8]) -> bool {
        match self {
            // It can replace a global variable, and what is inherited or missing becomes a property of the object itself.
            Double::Native => !builtin.is_global_object() && builtin.has_replaceable(name),
            Double::Defined => builtin.finds(name) && builtin.refuses(name, Change::Define),
        }
    }
}

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
    /// `double(object, "name")`. `is_double` is asked last.
    fn check_double<'a>(
        e: Expr<'a>,
        call: Call<'a>,
        double: Double,
        is_double: impl FnOnce() -> bool,
        cx: &mut Cx<'a, Self>,
    ) {
        let (Some(object), Some(key)) = (call.args().first(), call.args().get(1)) else {
            return;
        };
        if let Some(builtin) = builtin_named_by(object, None)
            && let Some(name) = key_name(key)
            && double.is_refused(builtin, &name)
            && is_double()
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

const DOUBLES: [&str; 9] = [
    "spyOn",
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
    .function_calls(&["spyOn"])
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
            if callee.is_ident("spyOn") {
                let is_of_bun =
                    || is_global_reference(callee) || is_import_from_module(callee, "bun:test");
                Self::check_double(e, call, Double::Native, is_of_bun, cx);
            }
            return;
        };
        match name.bytes() {
            b"spyOn" => Self::check_double(e, call, Double::Native, || true, cx),
            b"stub" | b"spy" | b"method" | b"getter" | b"setter" => {
                Self::check_double(e, call, Double::Defined, || true, cx);
            }
            // Not that of a string.
            b"replace" | b"replaceGetter" | b"replaceSetter" if call.args().len() == 3 => {
                Self::check_double(e, call, Double::Defined, || true, cx);
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
