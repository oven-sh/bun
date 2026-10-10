use bun_lint_oxlint::ast_util::static_property_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow Jest functions that have been deprecated, renamed, or replaced.
pub struct NoDeprecatedFunctions {
    /// The major version of Jest.
    version: usize,
}

const DEPRECATED_FUNCTION: Message = Message::new("", "\"{{deprecated}}\" has been deprecated in favor of \"{{new}}\"");

/// The property, since which version it is deprecated, what it is a property of, and the replacement.
const DEPRECATED_FUNCTIONS: [(&str, usize, &str, &str); 6] = [
    ("resetModuleRegistry", 15, "jest", "jest.resetModules"),
    ("addMatchers", 17, "jest", "expect.extend"),
    ("requireMock", 21, "require", "jest.requireMock"),
    ("requireActual", 21, "require", "jest.requireActual"),
    ("runTimersToTime", 22, "jest", "jest.advanceTimersByTime"),
    ("genMockFromModule", 26, "jest", "jest.createMockFromModule"),
];

/// The `29` of `29.1.0`.
fn major(version: &[u8]) -> Option<usize> {
    std::str::from_utf8(strings::split(version, b".").next()?).ok()?.parse().ok()
}

impl Rule for NoDeprecatedFunctions {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-deprecated-functions", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let version = options.object(0).object("jest").str("version");
        NoDeprecatedFunctions { version: version.and_then(|it| major(it.as_bytes())).unwrap_or(29) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        DEPRECATED_FUNCTIONS.iter().any(|it| file.mentions(it.0)).then_some(())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(property) = static_property_name(node)
            && let Some((property, base_version, object, replacement)) =
                DEPRECATED_FUNCTIONS.iter().find(|it| property.is(it.0))
            && node.object().is_some_and(|it| it.is_ident(object) && !it.is_parenthesized())
            && !node.is_jsx_tag_name()
            && !node.is_in_type_query()
            && jest_version(cx.file()).unwrap_or(self.version) >= *base_version
        {
            (cx.report(node, DEPRECATED_FUNCTION).data("deprecated", format!("{object}.{property}")).data("new", *replacement))
                .fix(|fixer| fixer.replace(node, *replacement));
        }
    }
}

/// `settings.jest.version`: `29`, `"29.1.0"` or `"v29.1.0"`
fn jest_version(file: &File) -> Option<usize> {
    let version = file.settings().get(b"jest")?.get(b"version")?;
    match version {
        Json::String(version) => major(version.strip_prefix(b"v").unwrap_or(version)),
        Json::Number(version) if *version >= 0.0 && version.fract() == 0.0 => Some(*version as usize),
        _ => None,
    }
}
