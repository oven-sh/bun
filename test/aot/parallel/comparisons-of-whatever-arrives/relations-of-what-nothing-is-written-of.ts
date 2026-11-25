// `a < b` and its kin, nothing is written of either
// Every subject is entered by value, from code that the build has not seen, with every pair out of a list of odd values: each row is what one left operand answers beside all right operands.
const call = new Function("f", "a", "b", "return f(a, b)") as (f: Function, a?: unknown, b?: unknown) => any;
class Crate { weight = 1; }
const crate = new Crate(), other = new Crate();
const doubles = new Float64Array([3, 0, -0, 7]);
const halves = [1.5, 3, 2147483647, -2147483648];
const left = "le", right = "ft";
const wide = "\u4e2d", wider = "\u6587";
const values: unknown[] = [0, -0, 1, -1, 3, doubles[0], doubles[1], doubles[2], halves[1], halves[2], halves[3], 1.5, NaN, Infinity, -Infinity, 2147483647, -2147483648, 2147483648, 4294967296, 9007199254740993,
    "", "a", "left", left + right, [left, right].join(""), "1", "3", wide, wide + wider, "\u4e2d\u6587", "le" + wide, 1n, BigInt("1"), 3n, 2n ** 70n, BigInt("1180591620717411303424"), true, false, undefined, null,
    Symbol.iterator, Symbol("x"), crate, other, {}, [], [3], function () {}, new String("a"), new Number(3), { valueOf() { return 3; } }, { toString() { return "left"; } }, Object(1n)];
function show(f: Function) {
    const rows: string[] = [];
    for (const a of values) {
        let row = "";
        for (const b of values) { try { const answer = call(f, a, b); row += answer === true ? "1" : answer === false ? "0" : String(answer); } catch (e) { row += "T"; } }
        rows.push(row);
    }
    console.log(f.name + "\n" + rows.join("\n"));
}
function lessValue(a: any, b: any) { return a < b; }
function lessBranch(a: any, b: any) { if (a < b) return 1; return 2; }
function lessInLoop(a: any, b: any) { let hits = 0; for (let i = 0; i < 3; i++) if (a < b) hits++; return hits; }
function lessBoth(a: any, b: any) { const first = a < b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a < b) ? 1 : 0; return (first ? 4 : 0) + hits; }
function lessOrSameValue(a: any, b: any) { return a <= b; }
function lessOrSameBranch(a: any, b: any) { if (a <= b) return 1; return 2; }
function lessOrSameInLoop(a: any, b: any) { let hits = 0; for (let i = 0; i < 3; i++) if (a <= b) hits++; return hits; }
function lessOrSameBoth(a: any, b: any) { const first = a <= b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a <= b) ? 1 : 0; return (first ? 4 : 0) + hits; }
function greaterValue(a: any, b: any) { return a > b; }
function greaterBranch(a: any, b: any) { if (a > b) return 1; return 2; }
function greaterInLoop(a: any, b: any) { let hits = 0; for (let i = 0; i < 3; i++) if (a > b) hits++; return hits; }
function greaterBoth(a: any, b: any) { const first = a > b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a > b) ? 1 : 0; return (first ? 4 : 0) + hits; }
function greaterOrSameValue(a: any, b: any) { return a >= b; }
function greaterOrSameBranch(a: any, b: any) { if (a >= b) return 1; return 2; }
function greaterOrSameInLoop(a: any, b: any) { let hits = 0; for (let i = 0; i < 3; i++) if (a >= b) hits++; return hits; }
function greaterOrSameBoth(a: any, b: any) { const first = a >= b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a >= b) ? 1 : 0; return (first ? 4 : 0) + hits; }
for (const f of [lessValue, lessBranch, lessInLoop, lessBoth, lessOrSameValue, lessOrSameBranch, lessOrSameInLoop, lessOrSameBoth, greaterValue, greaterBranch, greaterInLoop, greaterBoth, greaterOrSameValue, greaterOrSameBranch, greaterOrSameInLoop, greaterOrSameBoth]) show(f);
