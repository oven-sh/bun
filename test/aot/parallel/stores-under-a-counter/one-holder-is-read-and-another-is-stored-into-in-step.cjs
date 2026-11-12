// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (x === null || x === undefined) return String(x); if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(String).join(",") + "]"; return "object " + JSON.stringify(x); }
function twice(xs, out) { for (let i = 0; i < xs.length; i++) out[i] = xs[i] * 2; return out; }
function sums(xs, ys, out) { for (let i = 0; i < xs.length; i++) out[i] = xs[i] + ys[i]; return out; }
function both(xs, out, more) { for (let i = 0; i < xs.length; i++) { out[i] = xs[i] * 2; more[i] = xs[i] + 1; } return out; }
function onward(xs, out) { for (let i = 0; i < xs.length; i++) out[i + 1] = xs[i] + 1; return out; }
const byName = { twice, sums, both, onward }, name = text => JSON.parse('"' + text + '"');
function attempt(title, run, ...beside) { let said; try { said = show(run()); } catch (error) { said = error.constructor.name; } console.log(title, said, "|", beside.map(show).join(" | ")); }
for (let round = 0; round < 2; round++) {
  for (const kind of [Float64Array, Float32Array, Uint8Array, Int16Array, Uint8ClampedArray]) {
    const buffer = new ArrayBuffer(256), all = new Uint8Array(buffer); all.fill(3);
    const xs = kind.from([1, 2, 3, 4, 5, 6]);
    attempt(kind.name + " into its own kind", () => byName[name("twice")](xs, new kind(buffer, 64, 6)), all);
    attempt(kind.name + " into a shorter one", () => byName[name("twice")](xs, new kind(buffer, 128, 4)), all);
    attempt(kind.name + " into floats", () => byName[name("twice")](xs, new Float64Array(buffer, 192, 6)), all);
    attempt(kind.name + " into bytes", () => byName[name("twice")](xs, new Uint8Array(buffer, 8, 6)), all);
    attempt(kind.name + " into itself", () => byName[name("twice")](xs, xs), xs);
    attempt(kind.name + " sums", () => byName[name("sums")](xs, kind.from([9, 8, 7]), new kind(6)), xs);
    attempt(kind.name + " two are stored into", () => { const more = new kind(6); return show(byName[name("both")](xs, new kind(6), more)) + show(more); }, xs);
    const whole = kind.from([1, 2, 3, 4, 5, 6, 7, 8]);
    attempt(kind.name + " over one buffer, one place on", () => byName[name("twice")](whole.subarray(0, 6), whole.subarray(1, 7)), whole);
    attempt(kind.name + " over one buffer, one place back", () => byName[name("twice")](whole.subarray(1, 7), whole.subarray(0, 6)), whole);
    attempt(kind.name + " one further", () => byName[name("onward")](whole, whole), whole);
    for (const [title, make] of [["a list", () => [0, 0]], ["a list of texts", () => ["a", "b"]], ["an empty list", () => []], ["a frozen list", () => Object.freeze([1])], ["an object", () => ({})], ["a proxy", () => new Proxy([], {})], ["null", () => null], ["undefined", () => undefined], ["a number", () => 5]])
      attempt(kind.name + " into " + title, () => byName[name("twice")](xs, make()), xs);
  }
  attempt("a list into floats", () => byName[name("twice")]([1.5, 2.5, , 4], new Float64Array(4)));
  attempt("a list into a list", () => byName[name("twice")]([1.5, 2.5, , 4], []));
  { const buffer = new ArrayBuffer(64, { maxByteLength: 128 }); const out = new Float64Array(buffer); attempt("into one that follows its buffer", () => byName[name("twice")](Float64Array.of(1, 2, 3), out), out); buffer.resize(16); attempt("the buffer made shorter", () => byName[name("twice")](Float64Array.of(1, 2, 3), out), out); }
  { const buffer = new ArrayBuffer(64); const out = new Float64Array(buffer); structuredClone(buffer, { transfer: [buffer] }); attempt("into one whose buffer has gone", () => byName[name("twice")](Float64Array.of(1, 2, 3), out), out); }
}
