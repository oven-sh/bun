// Elements of an unknown text under its length minus what counts: the last against the first, two texts from their ends, beside arrays, views and whatever else has a length and an index.
function ends(w, t) { for (let i = 0; i < w.length; i++) { if (w[w.length - 1 - i] !== t[i]) return i; } return -1; }
function tails(w, t, p) { for (let i = 0; i < w.length; i++) { if (w[w.length - 1 - i] !== t[p - 1 - i]) return i; } return -1; }
function palindrome(w) { for (let i = 0; i < w.length; i++) { if (w[i] !== w[w.length - 1 - i]) return i; } return -1; }
function reversed(w) { let o = ""; for (let i = 0; i < w.length; i++) o += w[w.length - 1 - i]; return o; }
function beyond(w, n) { let o = ""; for (let i = 0; i < n; i++) o += String(w[w.length - i]) + String(w[w.length + i - 2]); return o; }
function steps(w, t) { let s = 0; for (let i = 0; i < w.length; i += 2) { if (w[w.length - 1 - i] === t[i]) s++; else if (w[w.length - 1 - i] === undefined) s += 100; } return s; }
function down(w, t) { let s = 0; for (let i = w.length; i-- > 0;) { if (w[w.length - 1 - i] === t[i]) s += i; } return s; }
function grows(w, t) { let s = ""; for (let i = 0; i < w.length && i < 9; i++) { if (w[w.length - 1 - i] !== t[0]) w = w + t; s += w.length; } return s; }
class Reader {
  constructor(input) { this.input = input; this.at = 0; }
  back(w) { for (let i = 0; i < w.length; i++) { if (w[w.length - 1 - i] !== this.input[this.at - 1 - i]) return i; } return -1; }
  front(w) { for (let i = 0; i < w.length; i++) { if (w[w.length - 1 - i] !== this.input[i]) return i; } return -1; }
}
const functions = [ends, (w, t) => tails(w, t, t?.length ?? 2), palindrome, reversed, w => beyond(w, 4), steps, down, grows, (w, t) => { const r = new Reader(t); r.at = t?.length ?? 1; return r.back(w) + "," + r.front(w); }];
const texts = JSON.parse('["", "a", "ab", "abc", "cba", "abcba", "äöü", "💡x💡", "Ā¢b", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", "baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]');
const rope = texts[9] + texts[10], part = (texts[9] + texts[3]).slice(3);
const odd = { length: 3, 0: "a", 1: "b", 2: "c" }, holes = ["a", , "c"], boxed = new String("abc");
const values = [...texts, rope, part, ["a", "b", "c"], Object.assign(["a", "b"], { "-1": "under" }), Object.setPrototypeOf(["c", "d"], { __proto__: Array.prototype, "-1": "above", get 2() { return "deep"; } }), [1, 2.5, 3], [1.5, 2.5], holes, [], new Uint8Array([97, 98, 99]), new Float64Array([1, NaN, -0]), boxed, odd, Object.freeze(["c", "b", "a"]), { get length() { return 2; }, get 0() { return "x"; }, 1: "y" },
  new Proxy(["a", "b"], {}), 5, true, null, undefined, 7n, Symbol.iterator, { length: -1 }, { length: "2", 0: "q", 1: "r" }, { length: 2.5, 0: 1, 1: 2 }, { length: NaN }, Buffer.from("abc"), (a, b) => a];
const show = v => (typeof v === "symbol" ? "symbol" : Object.is(v, -0) ? "-0" : String(v));
for (let round = 0; round < 2; round++) {
  functions.forEach((f, at) => {
    const row = [];
    for (const w of values) for (const t of [values[4], values[13], values[6], values[17], null]) { try { row.push(show(f(w, t))); } catch (error) { row.push(error.constructor.name); } }
    let hash = 0; const all = row.join(); for (let i = 0; i < all.length; i++) hash = (Math.imul(hash, 31) + all.charCodeAt(i)) | 0;
    console.log(round, at, hash, row.slice(10, 40).join());
  });
}
