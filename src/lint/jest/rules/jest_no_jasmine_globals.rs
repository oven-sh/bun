use bun_lint_oxlint::ast_util::{as_member_expression, static_property_info};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule reports on any usage of Jasmine globals, which are not ported to Jest, and suggests alternatives from Jest's own
/// API.
pub struct NoJasmineGlobals;

/// oxlint has the quotes.
const ILLEGAL_USAGE: Message = Message::new("", "\"Illegal usage of {{what}}\"");

/// With what the message and the `help` say of each.
const NON_JASMINE_PROPERTY_NAMES: [(&str, &str, &str); 4] = [
    ("spyOn", "global spyOn", "\"prefer use Jest own API `jest.spyOn`\""),
    ("spyOnProperty", "global spyOnProperty", "\"prefer use Jest own API `jest.spyOn`\""),
    ("fail", "`fail`", "\"prefer throwing an error, or the `done.fail` callback\""),
    ("pending", "`pending`,", "\"prefer explicitly skipping a test using `test.skip`\""),
];
const COMMON_HELP_TEXT: &str = "\"prefer using Jest's own API\"";

impl Rule for NoJasmineGlobals {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-jasmine-globals", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoJasmineGlobals
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if NON_JASMINE_PROPERTY_NAMES.iter().any(|it| file.mentions(it.0)) {
            on.finish(|_, cx| {
                for (name, what, help) in NON_JASMINE_PROPERTY_NAMES.into_iter().filter(|it| cx.file().mentions(it.0)) {
                    for reference in cx.file().unresolved_references_to(name.as_bytes()) {
                        cx.report(reference.span(), ILLEGAL_USAGE).data("what", what).help(help);
                    }
                }
            });
        }
        if !file.mentions("jasmine") {
            return;
        }
        on.exprs([ExprTag::Assign], |_, expr, cx| {
            if let ExprKind::Assign { target, value, .. } = expr.kind()
                && let Some((span, property_name)) = get_jasmine_property_name(target)
                && !expr.is_assignment_target()
            {
                let report = cx.report(span, ILLEGAL_USAGE).data("what", "jasmine global").help(COMMON_HELP_TEXT);
                // `jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000` is `jest.setTimeout(5000)`.
                if property_name.is("DEFAULT_TIMEOUT_INTERVAL")
                    && let ExprKind::Number(number) = value.kind()
                    && !value.is_parenthesized()
                {
                    report.fix(|fixer| fixer.replace(expr, format!("jest.setTimeout({number})")));
                }
            }
        });
        on.exprs([ExprTag::Call], |_, expr, cx| {
            if let Some(member_expr) = expr.callee().and_then(as_member_expression)
                && let Some((span, property_name)) = get_jasmine_property_name(member_expr)
                && let Some(object) = member_expr.object()
            {
                let report = cx.report(span, ILLEGAL_USAGE);
                match property_name.bytes() {
                    // `expect` has them too.
                    b"any" | b"anything" | b"arrayContaining" | b"objectContaining" | b"stringMatching" => {
                        (report.data("what", [b"`".as_slice(), property_name.bytes(), b"`".as_slice()].concat()))
                            .data("api", [b"expect.".as_slice(), property_name.bytes()].concat())
                            .fix(|fixer| fixer.replace(object, "expect"))
                    }
                    b"addMatchers" | b"createSpy" => {
                        report
                            .data("what", [b"`".as_slice(), property_name.bytes(), b"`".as_slice()].concat())
                            .data("api", if property_name.is("createSpy") { "jest.fn" } else { "expect.extend" })
                    }
                    _ => report.data("what", "jasmine global").help(COMMON_HELP_TEXT),
                };
            }
        });
    }
}

/// For `jasmine.a` and `jasmine["a"]`: where the `a` is written, and the `a`.
fn get_jasmine_property_name(member_expr: Expr<'_>) -> Option<(Span, Name<'_>)> {
    member_expr.object().filter(|it| it.is_ident("jasmine") && !it.is_parenthesized())?;
    static_property_info(member_expr)
}
