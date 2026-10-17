declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public amount: number, public label: string) {} }
interface Pt { x: number; y: number; }
let depth = 0;
function recAt(a: Rec[], i: number): Rec { if (depth > 0) { depth--; recAt(a, i); } return a[i]; }
function strAt(a: string[], i: number): string { if (depth > 0) { depth--; strAt(a, i); } return a[i]; }
function flagAt(a: boolean[], i: number): boolean { if (depth > 0) { depth--; flagAt(a, i); } return a[i]; }
function ptAt(a: Pt[], i: number): Pt { if (depth > 0) { depth--; ptAt(a, i); } return a[i]; }
function rowAt(a: Rec[][], i: number): Rec[] { if (depth > 0) { depth--; rowAt(a, i); } return a[i]; }
function orMake(a: Rec[], i: number): Rec { if (depth > 0) { depth--; orMake(a, i); } return a[i] || (a[i] = new Rec(i, "made")); }
function inTry(a: Rec[], i: number): string { try { return show(a[i]); } catch (e) { return "caught " + (e instanceof TypeError); } }
function count(a: Rec[]): string { let there = 0, nothing = 0, none = 0; for (const r of a) { if (r === undefined) nothing++; else if (r === null) none++; else there += r.amount; } return there + " " + nothing + " " + none; }
function countByIndex(a: Rec[]): string { let there = 0, nothing = 0, none = 0; for (let i = 0; i < a.length; i++) { const r = a[i]; if (r === undefined) nothing++; else if (r === null) none++; else there += r.amount; } return there + " " + nothing + " " + none; }
function show(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : v instanceof Rec ? "Rec " + v.amount + v.label : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v); }
function tell(name: string, f: () => unknown): void { let text: string; try { text = show(f()); } catch (e) { text = e instanceof TypeError ? "TypeError" : "threw " + String(e); } console.log(name + ": " + text); }
const R = (n: number) => new Rec(n, "r");
for (let turn = 0; turn < 2; turn++) {
    const recs = [R(1), R(2), R(3)];
    for (const i of [0, 2, 3, 100, -1, 0.5, NaN, 4294967294, 4294967295, 4294967296, -0]) tell("recs[" + (Object.is(i, -0) ? "-0" : i) + "]", () => recAt(recs, i));
    const holey = [R(1), R(2), R(3)]; delete (holey as unknown[])[1];
    tell("a hole", () => recAt(holey, 1)); tell("beside a hole", () => recAt(holey, 2)); tell("holes counted", () => count(holey) + " | " + countByIndex(holey));
    const nils: Rec[] = [R(1), undefined as unknown as Rec, null as unknown as Rec, R(4)];
    tell("undefined", () => recAt(nils, 1)); tell("null", () => recAt(nils, 2)); tell("nils counted", () => count(nils) + " | " + countByIndex(nils));
    tell("empty", () => recAt([], 0)); tell("new Array(3)", () => recAt(new Array<Rec>(3), 1)); tell("new Array(3) counted", () => count(new Array<Rec>(3)) + " | " + countByIndex(new Array<Rec>(3)));
    const longer = [R(1)]; longer.length = 3; tell("lengthened", () => recAt(longer, 2)); tell("lengthened counted", () => count(longer));
    const sparse = [R(1)]; sparse[200000] = R(2); tell("sparse, there", () => recAt(sparse, 200000)); tell("sparse, not there", () => recAt(sparse, 5)); tell("sparse, beyond", () => recAt(sparse, 200001));
    const frozen = Object.freeze([R(1), R(2)]) as Rec[]; tell("frozen", () => recAt(frozen, 1)); tell("frozen, beyond", () => recAt(frozen, 2)); tell("frozen counted", () => count(frozen));
    const named = [R(1)]; (named as unknown as Record<string, unknown>)["-1"] = R(9); (named as unknown as Record<string, unknown>)["1.5"] = R(8); (named as unknown as Record<string, unknown>)["4294967295"] = R(7);
    tell("named -1", () => recAt(named, -1)); tell("named 1.5", () => recAt(named, 1.5)); tell("named 4294967295", () => recAt(named, 4294967295));
    const heir = [R(1), , R(3)] as Rec[]; Object.setPrototypeOf(heir, { __proto__: Array.prototype, 1: R(50), 7: R(70) });
    tell("inherited in a hole", () => recAt(heir, 1)); tell("inherited beyond", () => recAt(heir, 7)); tell("not inherited", () => recAt(heir, 8));
    const got = [R(1), R(2)]; Object.defineProperty(got, "1", { get() { return R(60); }, configurable: true }); tell("a getter", () => recAt(got, 1));
    tell("plain object", () => recAt([{ amount: 5, label: "p" } as Rec], 0).amount); tell("JSON", () => recAt(JSON.parse('[{"amount":6,"label":"j"}]'), 0).amount);
    tell("made where absent", () => { const a: Rec[] = []; return orMake(a, 2).label + orMake(a, 2).label + a.length + show(recAt(a, 0)); });
    tell("in try", () => inTry(recs, 1) + inTry(recs, 9) + inTry(holey, 1) + inTry(nils, 2));
    const strs = ["a", "bc"]; tell("strs", () => strAt(strs, 1) + show(strAt(strs, 2)) + show(strAt(strs, -1))); const gap = ["a", "b", "c"]; delete (gap as unknown[])[1]; tell("strs, a hole", () => strAt(gap, 1));
    tell("constants", () => strAt(["x", "y", "z"], 2) + show(strAt(["x", "y", "z"], 3)));
    tell("flags", () => show(flagAt([true, false], 1)) + show(flagAt([true, false], 2)) + show(flagAt([true, undefined as unknown as boolean], 1)));
    tell("points", () => ptAt([{ x: 1, y: 2 }], 0).y + show(ptAt([{ x: 1, y: 2 }], 1))); tell("rows", () => rowAt([[R(1)], []], 0).length + show(rowAt([[R(1)], []], 2)));
    tell("used though absent", () => recAt(recs, 7).amount); tell("used though a hole", () => recAt(holey, 1).amount);
}
