// -0 is the key of reads and stores of arrays of every kind, typed arrays and strings; it comes out of `??`, a product, a negation, `Math.round`.
declare const console: { log(...values: unknown[]): void };
class Node { id: number; merge?: number; constructor(id: number, merge?: number) { this.id = id; if (merge !== undefined) this.merge = merge; } }
const key = (n: Node): number => n.merge ?? 1e21;
function readStrings(a: string[], n: Node): string { return String(a[key(n)]); }
function readNumbers(a: number[], n: Node): string { return String(a[key(n)]); }
function readDoubles(a: number[], n: Node): string { return String(a[key(n)]); }
function readObjects(a: { v: number }[], n: Node): string { const o = a[key(n)]; return o === undefined ? "none" : String(o.v); }
function readTyped(a: Float64Array, n: Node): string { return String(a[key(n)]); }
function readBytes(a: Uint8Array, n: Node): string { return String(a[key(n)]); }
function readOfText(a: string, n: Node): string { return String(a[key(n)]); }
function storeStrings(a: string[], n: Node): string { a[key(n)] = "S"; return a.join() + "/" + a.length + "/" + Object.keys(a).join(); }
function storeNumbers(a: number[], n: Node): string { a[key(n)] = 9; return a.join() + "/" + a.length + "/" + Object.keys(a).join(); }
function storeTyped(a: Float64Array, n: Node): string { a[key(n)] = 9.5; return a.join() + "/" + Object.keys(a).join(); }
function hasIt(a: string[], n: Node): string { return String(key(n) in a) + String(Object.hasOwn(a, key(n))); }
function deleteIt(a: string[], n: Node): string { delete a[key(n)]; return a.join() + "/" + Object.keys(a).join(); }
function byProduct(a: string[], p: number, q: number): string { return String(a[p * q]); }
function byNegation(a: string[], p: number): string { return String(a[-p]); }
function byRound(a: string[], p: number): string { return String(a[Math.round(p)]); }
for (let i = 0; i < 300; i++) { const n = new Node(i, i & 1); readStrings(["a", "b"], n); readNumbers([1, 2], n); readDoubles([0.5, 1.5], n); readObjects([{ v: 1 }, { v: 2 }], n); readTyped(new Float64Array(2), n); readBytes(new Uint8Array(2), n); readOfText("ab", n); storeStrings(["a", "b"], n); storeNumbers([1, 2], n); storeTyped(new Float64Array(2), n); hasIt(["a"], n); deleteIt(["a", "b"], n); byProduct(["a", "b"], i & 1, 1); byNegation(["a"], 0); byRound(["a", "b"], (i & 1) + 0.2); }
for (const v of [0, -0, 1]) { const n = new Node(1, v); console.log(Object.is(v, -0) ? "-0" : String(v), readStrings(["a", "b"], n), readNumbers([1, 2], n), readDoubles([0.5, 1.5], n), readObjects([{ v: 1 }, { v: 2 }], n), readTyped(new Float64Array([1.5, 2.5]), n), readBytes(new Uint8Array([7, 8]), n), readOfText("ab", n), "|", storeStrings(["a", "b"], n), storeNumbers([1, 2], n), storeTyped(new Float64Array(2), n), "|", hasIt(["a", "b"], n), deleteIt(["a", "b"], n)); }
console.log(byProduct(["a", "b"], -1, 0), byProduct(["a", "b"], 0, -5), byNegation(["a", "b"], 0), byRound(["a", "b"], -0.2), byRound(["a", "b"], -0));
