// `a == b`, both written numbers: valueOf, toString, BigInt beside a text
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
function alikeValue(a: number, b: number) { return a == b; }
function alikeBranch(a: number, b: number) { if (a == b) return 1; return 2; }
function alikeInLoop(a: number, b: number) { let hits = 0; for (let i = 0; i < 3; i++) if (a == b) hits++; return hits; }
function alikeBoth(a: number, b: number) { const first = a == b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a == b) ? 1 : 0; return (first ? 4 : 0) + hits; }
function unlikeValue(a: number, b: number) { return a != b; }
function unlikeBranch(a: number, b: number) { if (a != b) return 1; return 2; }
function unlikeInLoop(a: number, b: number) { let hits = 0; for (let i = 0; i < 3; i++) if (a != b) hits++; return hits; }
function unlikeBoth(a: number, b: number) { const first = a != b; let hits = 0; for (let i = 0; i < 2; i++) hits += (a != b) ? 1 : 0; return (first ? 4 : 0) + hits; }
for (const f of [alikeValue, alikeBranch, alikeInLoop, alikeBoth, unlikeValue, unlikeBranch, unlikeInLoop, unlikeBoth]) show(f);
