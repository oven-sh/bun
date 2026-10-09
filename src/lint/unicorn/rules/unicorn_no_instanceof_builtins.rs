use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `instanceof` with built-in objects.
pub struct NoInstanceofBuiltins {
    include: Vec<String>,
    exclude: Vec<String>,
    use_error_is_error: bool,
    is_strict: bool,
}

const NO_INSTANCEOF_BUILTINS: Message = Message::new("", "Do not use `instanceof` with built-in constructors");
const USE_ALTERNATIVE: Message = Message::new(
    "",
    "Use `Array.isArray(…)`, `typeof … === 'string'`, or another realm-safe alternative instead",
);

const STRICT_STRATEGY_CONSTRUCTORS: [&str; 35] = [
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "InternalError",
    "AggregateError",
    "Map",
    "Set",
    "WeakMap",
    "WeakRef",
    "WeakSet",
    "ArrayBuffer",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "Object",
    "RegExp",
    "Promise",
    "Proxy",
    "DataView",
    "Date",
    "SharedArrayBuffer",
    "FinalizationRegistry",
];

impl Rule for NoInstanceofBuiltins {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-instanceof-builtins", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let strings = |key: &str| options.strings(key).into_iter().map(str::to_owned).collect();
        NoInstanceofBuiltins {
            include: strings("include"),
            exclude: strings("exclude"),
            use_error_is_error: options.bool_or("useErrorIsError", false),
            is_strict: options.str("strategy") == Some("strict"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.binaries([BinOp::Instanceof], |rule, e, cx| {
            let ExprKind::Binary { left, right, .. } = e.kind() else {
                return;
            };
            let Some(ctor_name) = get_inner_expression(right).as_ident() else {
                return;
            };
            if rule.exclude.iter().any(|it| ctor_name.is(it)) {
                return;
            }
            // What is before and after the left operand in the replacement.
            let around: Option<(&str, &str)> = match ctor_name.bytes() {
                b"Array" => Some(("Array.isArray(", ")")),
                b"Error" if rule.use_error_is_error => Some(("Error.isError(", ")")),
                b"Function" => Some(("typeof (", ") === 'function'")),
                b"String" => Some(("typeof (", ") === 'string'")),
                b"Number" => Some(("typeof (", ") === 'number'")),
                b"Boolean" => Some(("typeof (", ") === 'boolean'")),
                b"BigInt" => Some(("typeof (", ") === 'bigint'")),
                b"Symbol" => Some(("typeof (", ") === 'symbol'")),
                _ => None,
            };
            let span = Span::new(left.outer_span().start, right.outer_span().end);
            if let Some((before, after)) = around {
                cx.report(span, NO_INSTANCEOF_BUILTINS).suggest(USE_ALTERNATIVE, |fixer| {
                    let left_text = fixer.file().slice(left.outer_span());
                    fixer.replace(span, [before.as_bytes(), left_text, after.as_bytes()].concat())
                });
            } else if rule.include.iter().any(|it| ctor_name.is(it))
                || rule.is_strict && ctor_name.is_any(&STRICT_STRATEGY_CONSTRUCTORS)
            {
                cx.report(span, NO_INSTANCEOF_BUILTINS);
            }
        });
    }
}
