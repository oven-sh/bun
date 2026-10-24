// `+x` is NaN where x is undefined, also where the compiler knows that it is: a literal, `void 0`, a variable nobody stores to, a parameter every caller leaves out.
const shown = (label, value) => console.log(label, typeof value, String(value), Number.isNaN(value), Object.is(value, NaN), JSON.stringify([value]));
function plus(a) { return +a; }
function minus(a) { return -a; }
function twiceMinus(a) { return -(-a); }
function not(a) { return ~a; }
function up(a) { a++; return a; }
function down(a) { --a; return a; }
function before(a) { return a++; }
function number(a) { return Number(a); }
function times(a) { return a * 1; }
function less(a) { return a - 0; }
function over(a) { return a / 1; }
function power(a) { return a ** 1; }
function absolute(a) { return Math.abs(a); }
function largest(a) { return Math.max(a); }
function rounded(a) { return Math.round(a); }
function kept(a) { const held = { n: +a }; return held.n; }
function listed(a) { const list = [+a]; return list[0]; }
function floats(a) { const list = new Float64Array(1); list[0] = +a; return list[0]; }
function chosen(a) { return a > 0 ? 1 : +a; }
function added(a) { return +a + 1; }
function text(a) { return `${+a}`; }
for (const f of [plus, minus, twiceMinus, not, up, down, before, number, times, less, over, power, absolute, largest, rounded, kept, listed, floats, chosen, added, text]) shown(f.name, f());
shown("a literal", +undefined);
shown("void", +(void 0));
shown("void of a call", +(void shown));
let never;
shown("a variable nobody stores to", +never);
const constant = undefined;
shown("a constant", +constant);
shown("typeof", typeof +undefined);
shown("isNaN", Number.isNaN(+undefined));
shown("compared", +undefined === undefined);
shown("or", +undefined || "falls through");
shown("nullish", +undefined ?? "does not fall through");
shown("null", +null);
shown("in an object", JSON.stringify({ n: +undefined }));
shown("a key", Object.keys({ [+undefined]: 1 })[0]);
shown("handed on", plus(plus()));
function only(a) { return +a; }
shown("a parameter every caller leaves out", only());
function onlyMinus(a) { return -a; }
shown("the same, negated", onlyMinus());
function onlyNumber(a) { return Number(a); }
shown("the same, by Number", onlyNumber());
function onlyTimes(a) { return a * 1; }
shown("the same, times one", onlyTimes());
function onlyUp(a) { a++; return a; }
shown("the same, raised", onlyUp());
function onlyBefore(a) { return a++; }
shown("the same, as it was before it was raised", onlyBefore());
function onlyAbsolute(a) { return Math.abs(a); }
shown("the same, by Math.abs", onlyAbsolute());
function onlyNot(a) { return ~a; }
shown("the same, inverted", onlyNot());
