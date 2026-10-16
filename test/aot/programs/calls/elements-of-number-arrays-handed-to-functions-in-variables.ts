// `f(values[i])`: the checker says number; past the end, or in a hole, the element is undefined, and whoever is called decides what that means.
type Unary = (x: number) => number;
type Binary = (x: number, y: number) => number;
type Test = (x: number) => boolean;
interface Holder { unary: Unary; binary: Binary }

const lines: string[] = [];
function show(n: number): string { return Object.is(n, -0) ? "-0" : String(n); }
function say(label: string, ...values: (number | boolean | string)[]): void { lines.push(label + ": " + values.map(v => (typeof v === "number" ? show(v) : String(v))).join(" ")); }

function adder(k: number): Unary { return x => x + k; }
function scaler(k: number): Unary { return (x: number): number => x * k; }
function orElse(k: number): Unary { return (x: number): number => (x === undefined ? k : x); }
function both(k: number): Binary { return (x, y) => x * k + y; }
function above(k: number): Test { return x => x > k; }
function count(): Unary { let calls = 0; return x => ++calls + (x === x ? 0 : 1000); }

let inVariable: Unary = adder(1);
const holder: Holder = { unary: scaler(3), binary: both(2) };
const doubles: number[] = [0.5, 1.5, -0, NaN, 1e300];
const integers: number[] = [1, 2, 3, 2147483647, -2147483648];
const holes: number[] = [1, , 3] as number[];
const empty: number[] = [];

function throughParameter(f: Unary, values: number[], upTo: number): number { let total = 0; for (let i = 0; i < upTo; i++) total += f(values[i]); return total; }
function throughVariable(values: number[], upTo: number): number { let total = 0; for (let i = 0; i < upTo; i++) total += inVariable(values[i]); return total; }
function throughField(h: Holder, values: number[], upTo: number): number { let total = 0; for (let i = 0; i < upTo; i++) { const f = h.unary; total += f(values[i]); } return total; }
function twoElements(f: Binary, values: number[], upTo: number): number { let total = 0; for (let i = 0; i < upTo; i++) total += f(values[i], values[i + 1]); return total; }
function tests(f: Test, values: number[], upTo: number): number { let passed = 0; for (let i = 0; i < upTo; i++) if (f(values[i])) passed++; return passed; }
function each(f: Unary, values: number[], upTo: number): string { const out: string[] = []; for (let i = 0; i < upTo; i++) out.push(show(f(values[i]))); return out.join(","); }

for (let round = 0; round < 3; round++) {
    for (const [name, values] of [["doubles", doubles], ["integers", integers], ["holes", holes], ["empty", empty]] as [string, number[]][]) {
        const within = values.length, beyond = values.length + 2;
        say(name + " within", throughParameter(adder(round), values, within), throughVariable(values, within), throughField(holder, values, within), tests(above(round), values, within));
        say(name + " beyond", throughParameter(adder(round), values, beyond), throughVariable(values, beyond), throughField(holder, values, beyond), tests(above(round), values, beyond));
        say(name + " two", twoElements(both(round), values, within), twoElements(holder.binary, values, beyond));
        say(name + " each", each(scaler(round + 1), values, beyond), each(orElse(round), values, beyond), each(count(), values, beyond));
    }
    inVariable = round & 1 ? adder(round) : orElse(-round);
    holder.unary = round & 1 ? orElse(7) : adder(0.25);
}
say("functions of the engine", each(Math.abs, doubles, 7), each(Math.floor, holes, 4), each(Math.sqrt, empty, 1));
say("an untyped function", each(((x: any) => (x === undefined ? -1 : x + 1)) as Unary, holes, 5));
say("a bound function", each(both(2).bind(null, 10) as Unary, doubles, 6));

// One function, called by several signatures: whichever of them it is best reached by, the others find it all the same.
type Nullary = () => number;
type Ternary = (x: number, y: number, z: number) => number;
type Sink = (x: number) => void;
function byNullary(f: Nullary): number { return f() + 0.5; }
function byUnary(f: Unary, x: number): number { return f(x) + 0.5; }
function byBinary(f: Binary, x: number, y: number): number { return f(x, y) + 0.5; }
function byTernary(f: Ternary, x: number, y: number, z: number): number { return f(x, y, z) + 0.5; }
function byTest(f: Test, x: number): string { return f(x) ? "yes" : "no"; }
function bySink(f: Sink, x: number): void { f(x); }
let seen = 0;
function constant(k: number): Nullary { return () => k + 0.25; }
function noting(k: number): Unary { return x => { seen += x; return x - k; }; }
function three(k: number): Ternary { return (x, y, z) => x + y * z + k; }
const takingNone: Nullary[] = [constant(1), constant(-0.25)];
const takingOne: Unary[] = [...takingNone, adder(2.5), noting(4), orElse(9), Math.abs];
const takingTwo: Binary[] = [...takingOne, both(3), Math.atan2];
const takingThree: Ternary[] = [...takingTwo, three(0.125), Math.max, Math.hypot];
for (let round = 0; round < 2; round++) {
    say("by no argument", ...takingNone.map(f => byNullary(f)));
    say("by one", ...takingOne.map(f => byUnary(f, 1.5 + round)));
    say("by two", ...takingTwo.map(f => byBinary(f, 1.5 + round, 2.5)));
    say("by three", ...takingThree.map(f => byTernary(f, 1.5 + round, 2.5, 3.5)));
    for (const f of takingOne) bySink(f, 0.75);
    say("seen", seen, byTest(above(1), 1.5 + round), byTest(above(2), 1.5 + round));
}
console.log(lines.join("\n"));
