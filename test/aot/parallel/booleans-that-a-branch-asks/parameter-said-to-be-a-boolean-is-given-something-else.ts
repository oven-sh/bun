// a parameter is declared a boolean, and a caller that knows no types gives it something else: what is tested is handed on as it came
const show = (v) => typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : String(v));
const values = [0, -0, 1, 2, 3, 2.5, NaN, Infinity, "", "1", "a", null, undefined, true, false, 1n, 0n, {}, [], [1], Symbol.iterator];
function subject(flag: boolean): unknown { if (flag) return flag; return flag; }
function either(flag: boolean, other: unknown): unknown { return flag || other; }
function both(flag: boolean, other: unknown): unknown { return flag && other; }
const untyped: any = { subject, either, both };
console.log(values.map(v => show(untyped.subject(v))).join(" "));
console.log(values.map(v => show(untyped.either(v, "other"))).join(" "));
console.log(values.map(v => show(untyped.both(v, "other"))).join(" "));
console.log(show(subject(true)), show(subject(false)), show(either(false, 1)), show(both(true, 1)));
