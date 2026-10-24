declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public n: number) {} }
interface Holder { place: number; }
let depth = 0;
function recAt(a: Rec[], h: Holder): Rec | undefined { if (depth > 0) { depth--; recAt(a, h); } return a[h.place]; }
function textAt(a: string[], h: Holder): string | undefined { if (depth > 0) { depth--; textAt(a, h); } return a[h.place]; }
function maybeAt(a: (Rec | undefined | null)[], h: Holder): Rec | undefined | null { if (depth > 0) { depth--; maybeAt(a, h); } return a[h.place]; }
function nOf(a: Rec[], h: Holder): number { if (depth > 0) { depth--; nOf(a, h); } const rec = a[h.place]; return rec ? rec.n : -1; }
function sumBy(a: Rec[], places: Holder[]): number { let t = 0; for (const h of places) { const rec = a[h.place]; if (rec) t += rec.n; } return t; }
function show(v: unknown): string { return v instanceof Rec ? "Rec" + v.n : String(v); }
const places = [0, 1, 2, 3, -1, -0, 0.5, 1.5, NaN, Infinity, -Infinity, 4294967294, 4294967295, 4294967296, 9007199254740992, -9223372036854775808, 1e300, 2147483648, 5000].map(place => ({ place }));
const recs = [new Rec(1), new Rec(2), new Rec(3)]; const texts = ["a", "b", "c"];
const holes = [new Rec(1), , new Rec(3)] as Rec[]; const sparse: Rec[] = []; sparse[5000] = new Rec(50); const frozen = Object.freeze(recs.slice()) as Rec[];
const named = recs.slice() as Rec[] & Record<string, unknown>; named["-1"] = new Rec(-1); named["0.5"] = new Rec(5); named["NaN"] = new Rec(99); named["Infinity"] = new Rec(77); named["4294967295"] = new Rec(42); named["-9223372036854775808"] = new Rec(63); named["1e+300"] = new Rec(300);
class Recs extends Array<Rec> {} const derived = new Recs(); derived.push(new Rec(21), new Rec(22));
for (let round = 0; round < 2; round++) {
    for (const [name, a] of [["recs", recs], ["holes", holes], ["sparse", sparse], ["frozen", frozen], ["named", named], ["derived", derived], ["empty", []]] as [string, Rec[]][])
        console.log(name, places.map(h => show(recAt(a, h)) + "/" + nOf(a, h)).join(" "), sumBy(a, places));
    console.log("texts", places.map(h => show(textAt(texts, h))).join(" "));
    console.log("maybe", places.map(h => show(maybeAt([undefined, null, new Rec(3)], h))).join(" "));
}
