// for (const x of ..) in evaluated text over generators and over iterators whose results are objects of every kind and change while the loop runs.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
class Result { constructor(value, done) { this.value = value; this.done = done; } }
class Told { #v; #d; constructor(v, d) { this.#v = v; this.#d = d; } get value() { return this.#v; } get done() { return this.#d; } }
function* compiled(n) { for (let i = 0; i < n; i++) yield i; }
const program = { collect: () => globalThis.Bun?.gc?.(true), compiled, literal: (value, done) => ({ value, done }), swapped: (value, done) => ({ done, value }), Result, Told, late: (value, done) => { const o = { done }; o.value = value; return o; }, optional: (value, done) => done ? { done } : { value }, list: n => Array.from({ length: n }, (_, i) => i) };
const text = `
const lines = [], show = x => typeof x === "symbol" ? "sym" : typeof x === "object" && x ? "{" + Object.keys(x) + "}" : String(x);
const up = { done: false, value: "up" }, bare = Object.create(null), sym = Symbol("s");
const makers = [
  (v, d) => ({ value: v, done: d }), (v, d) => ({ done: d, value: v }), (v, d) => program.literal(v, d), (v, d) => program.swapped(v, d), (v, d) => new program.Result(v, d), (v, d) => new program.Told(v, d), (v, d) => program.late(v, d), (v, d) => program.optional(v, d),
  (v, d) => d ? { done: true } : { value: v }, (v, d) => ({ value: v, done: d ? 1 : 0 }), (v, d) => ({ value: v, done: d ? "yes" : "" }), (v, d) => ({ value: v, done: d ? {} : null }), (v, d) => ({ value: v, done: d ? sym : undefined }), (v, d) => ({ value: v, done: d ? 1n : 0n }), (v, d) => ({ value: v, done: d ? NaN + 1 || 1 : NaN }),
  (v, d) => ({ get value() { return v; }, get done() { return d; } }), (v, d) => ({ value: v, get done() { return d; } }), (v, d) => ({ get value() { return v; }, done: d }), (v, d) => { const o = Object.create(up); if (d) o.done = true; if (v > 1) o.value = v; return o; }, (v, d) => Object.assign(Object.create({ value: "inherited" }), { done: d }), (v, d) => Object.assign(Object.create(null), { value: v, done: d }),
  (v, d) => new Proxy({ value: v, done: d }, {}), (v, d) => new Proxy({}, { get: (t, k) => k === "done" ? d : k === "value" ? v : undefined }), (v, d) => Object.assign([v], { value: v, done: d }), (v, d) => Object.assign(() => 1, { value: v, done: d }), (v, d) => { const o = { value: v, done: d, x: 1 }; delete o.x; return o; }, (v, d) => { const o = { x: 1, y: 2, value: v, done: d }; delete o.x; delete o.y; return o; },
  (v, d) => { const o = {}; for (let i = 0; i < 40; i++) o["k" + i] = i; o.value = v; o.done = d; return o; }, (v, d) => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, done: d, value: v }), (v, d) => Object.freeze({ value: v, done: d }), (v, d) => Object.defineProperty({ done: d }, "value", { get: () => v, configurable: true }), (v, d) => JSON.parse(d ? '{"done":true}' : '{"done":false,"value":' + JSON.stringify(v ?? null) + "}"), (v, d) => ({ ...{ value: v }, done: d }), (v, d) => new (class { value = v; done = d; })(), (v, d) => Object.assign(new Map(), { value: v, done: d }), (v, d) => Object.assign(new Error("e"), { value: v, done: d }),
  (v, d) => v === 3 ? 5 : { value: v, done: d }, (v, d) => v === 3 ? null : { value: v, done: d }, (v, d) => v === 2 ? undefined : { value: v, done: d }, (v, d) => ({ get value() { throw new RangeError("value" + v); }, done: d }), (v, d) => ({ value: v, get done() { if (v === 2) throw new RangeError("done"); return d; } }),
];
const iterable = (make, n) => ({ i: 0, [Symbol.iterator]() { return this; }, next() { const i = this.i++; return make(i, i >= n); }, return() { lines.push("returned"); return {}; } });
const tell = (name, f) => { let r; try { r = f(); } catch (e) { r = e?.name + " " + String(e?.message).slice(0, 40); } lines.push(name + " " + String(r).slice(0, 90)); };
function* own(n) { for (let i = 0; i < n; i++) { const t = yield i; if (t) return t; } return "end"; }
function* nested(n) { yield "a"; yield* own(n); yield* [7, 8]; yield* program.compiled(2); return 1; }
for (let turn = 0; turn < 3; turn++) {
  for (const [m, make] of makers.entries()) {
    tell("walk " + m, () => { let r = ""; for (const x of iterable(make, 5)) { r += show(x) + " "; if (r.length > 200) break; } return r; });
    tell("cut " + m, () => { let r = ""; for (const x of iterable(make, 9)) { r += show(x) + " "; if (r.length > 5) break; } return r; });
    const other = makers[(m * 7 + turn) % makers.length], third = makers[(m + 3) % makers.length];
    tell("two " + m, () => { let r = ""; for (const x of iterable((v, d) => (v & 1 ? make : other)(v, d), 8)) { r += show(x) + " "; if (r.length > 300) break; } return r.length + r; });
    tell("three " + m, () => { let r = ""; for (let t = 0; t < 4; t++) for (const x of iterable([make, other, third, make][t], 4)) { r += show(x) + " "; if (r.length > 300) break; } return r.length + r; });
    tell("shared " + m, () => { const o = make(1, false); let n = 0, r = ""; for (const x of { [Symbol.iterator]() { return { next() { if (++n === 4) try { o.done = true; } catch (e) { return { done: true }; } if (n === 3) try { o.value = "new"; } catch (e) { } if (n === 2) try { Object.defineProperty(o, "value", { get: () => "got", configurable: true }); } catch (e) { } return n > 6 ? { done: true } : o; } }; } }) r += show(x) + " "; return n + r; });
    tell("spread " + m, () => [...iterable(make, 4)].map(show).join());
    tell("taken " + m, () => { const [a, b, ...c] = iterable(make, 5); return [a, b, c.length].map(show).join(); });
    if (m % 11 === 3) program.collect();
  }
  tell("own", () => { let r = ""; for (const x of own(5)) r += x; return r; });
  tell("nested", () => { let r = ""; for (const x of nested(3)) r += x; return r; });
  tell("compiled", () => { let r = ""; for (const x of program.compiled(5)) r += x; return r; });
  tell("summed", () => { let s = 0; for (let t = 0; t < 30; t++) for (const x of own(6)) s = s * 3 + x | 0; return s; });
  tell("thrown", () => { let r = ""; const g = own(5); try { for (const x of g) { r += x; if (x === 2) throw new TypeError("in"); } } catch (e) { r += e.message; } return r + show(g.next().done); });
  tell("inside", () => { let r = ""; for (const x of own(3)) for (const y of own(2)) r += x + "" + y + " "; return r; });
  tell("then", () => { let r = ""; const lists = [own(2), program.compiled(2), [1, 2], new Set([3]), "ab", iterable(makers[0], 2), new Map([[1, 2]]).keys()]; for (const l of lists) for (const x of l) r += show(x) + " "; return r; });
}
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
