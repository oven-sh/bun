// `10 ** null` is 1: null is 0 as a number, also where the compiler knows the exponent to be null and has code of its own for the bases 2 and 10.
const unknown = x => x;
const shown = (label, ...values) => console.log(label, ...values.map(value => `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`));
shown("written", 10 ** null, 2 ** null, 0 ** null, (-3) ** null, 1.5 ** null, NaN ** null, Infinity ** null);
shown("other exponents", 10 ** false, 10 ** true, 2 ** true, 10 ** 0, 10 ** -0, 10 ** "", 10 ** "0", 2 ** "3", 10 ** [], 10 ** undefined, 2 ** undefined, 2 ** {}, 10 ** "x");
const constant = null;
shown("a constant", 10 ** constant, 2 ** constant);
let variable = null;
shown("a variable", 10 ** variable, 2 ** variable, unknown(10) ** variable, unknown(10) ** null, 10 ** unknown(null), 2 ** unknown(null));
function tenTo(x) { return 10 ** x; }
shown("a parameter that is always null", tenTo(null));
function twoTo(x) { return 2 ** x; }
shown("the same, of two", twoTo(null));
function tenToEither(x) { return 10 ** x; }
shown("a parameter that is null or a number", tenToEither(null), tenToEither(2), tenToEither(-1), tenToEither(0.5), tenToEither(400));
function twoToEither(x) { return 2 ** x; }
shown("the same, of two", twoToEither(null), twoToEither(10), twoToEither(-1), twoToEither(0.5), twoToEither(1024), twoToEither(-1075));
function tenToMissing(x) { return 10 ** x; }
shown("a parameter every caller leaves out", tenToMissing());
function power(base, x) { return base ** x; }
shown("both are parameters", power(10, null), power(2, null), power(null, null), power(null, 2));
function toNull(base) { return base ** null; }
shown("the base is a parameter", toNull(10), toNull(2.5), toNull("3"), toNull(null), toNull(undefined));
let assigned = 10;
assigned **= null;
shown("assigned", assigned);
let two = 2;
two **= null;
shown("assigned, of two", two);
shown("Math.pow", Math.pow(10, null), Math.pow(2, null), Math.pow(10, constant), Math.pow(unknown(10), null), Math.pow(10, undefined), Math.pow(2, true));
shown("null is the base", null ** 10, null ** null, null ** 0, false ** null, true ** null, "" ** null, "2" ** null, [] ** null, undefined ** null);
shown("used further", 10 ** null - 7, (10 ** null) | 0, [10 ** null][0], { n: 2 ** null }.n, `${10 ** null}`, Number.isNaN(10 ** null));
