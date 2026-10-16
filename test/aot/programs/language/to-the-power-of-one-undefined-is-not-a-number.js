// `x ** 1` is NaN where x is undefined, also where the compiler knows that it is: to the power of one a number is itself, and undefined is no number.
const unknown = x => x;
const shown = (label, ...values) => console.log(label, ...values.map(value => `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}`));
shown("written", undefined ** 1, (void 0) ** 1, null ** 1, undefined ** 1.0, undefined ** 0, undefined ** 2, undefined ** 3, undefined ** 0.5, undefined ** -0.5, undefined ** -1);
let never;
shown("a variable nobody stores to", never ** 1, never ** 2, never ** 0);
const constant = undefined;
shown("a constant", constant ** 1, Math.pow(constant, 1));
function toOne(x) { return x ** 1; }
shown("a parameter every caller leaves out", toOne());
function nullToOne(x) { return x ** 1; }
shown("a parameter that is always null", nullToOne(null));
function eitherToOne(x) { return x ** 1; }
shown("a parameter that is given or left out", eitherToOne(), eitherToOne(2.5), eitherToOne(-0), eitherToOne(NaN), eitherToOne(null), eitherToOne("3"), eitherToOne(true));
function byMath(x) { return Math.pow(x, 1); }
shown("Math.pow", byMath(), Math.pow(undefined, 1), Math.pow(never, 1), Math.pow(null, 1), Math.pow(unknown(undefined), 1), Math.pow(undefined, unknown(1)));
let assigned;
assigned **= 1;
shown("assigned", assigned);
function nothing() {}
shown("what a function without a return yields", nothing() ** 1, Math.pow(nothing(), 1));
shown("an absent property", ({ y: 1 }).x ** 1, [1.5][3] ** 1, new Map().get(1) ** 1);
shown("asked about", typeof (undefined ** 1), Number.isNaN(undefined ** 1), (undefined ** 1) === undefined, (undefined ** 1) ?? "does not fall through", (undefined ** 1) || "falls through", JSON.stringify([undefined ** 1]), Object.keys({ [undefined ** 1]: 1 })[0], `${undefined ** 1}`);
shown("used further", undefined ** 1 + 1, -(undefined ** 1), (undefined ** 1) ** 1, [undefined ** 1][0], { n: undefined ** 1 }.n, toOne(toOne()));
shown("numbers are themselves", 2.5 ** 1, (-0) ** 1, NaN ** 1, Infinity ** 1, unknown(7) ** 1, "4" ** 1, true ** 1, [] ** 1);
