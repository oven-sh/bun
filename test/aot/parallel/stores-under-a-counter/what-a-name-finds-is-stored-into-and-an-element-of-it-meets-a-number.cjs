// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(",") + "]"; return "object " + JSON.stringify(x); }
function fill(t, n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i + t; return b[t & 7] & 255; }
function fillSeven(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = 7; return b[3] & 255; }
function fillInTry(t, n) { const b = globalThis.held; let turns = 0; try { for (let i = 0; i < n; i++) { b[i] = i + t; turns++; } } catch (error) { return error.constructor.name + " behind " + turns; } return b[t & 7] & 255; }
function attempt(name, run, beside) { let said; try { said = String(run()); } catch (error) { said = error.constructor.name + ": " + error.message; } console.log(name, said, show(globalThis.held), "| beside:", show(beside())); }
function over(made, beside, name) {
  globalThis.held = made;
  attempt(name + " fractions", () => fill(0.5, 14), beside); attempt(name + " whole", () => fill(3, 14), beside); attempt(name + " seven", () => fillSeven(14), beside); attempt(name + " in a try", () => fillInTry(9, 14), beside); attempt(name + " past int32", () => fill(2147483640, 14), beside);
}
{ const buffer = new ArrayBuffer(96); const all = new Uint8Array(buffer); all.fill(200); for (const kind of [Uint8Array, Int8Array, Uint8ClampedArray]) over(new kind(buffer, 32, 12), () => all, kind.name); }
{ const buffer = new ArrayBuffer(256); const all = new Uint8Array(buffer); all.fill(9); for (const kind of [Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) over(new kind(buffer, 64, 12), () => all, kind.name); }
{ const whole = Buffer.alloc(64, 7); over(whole.subarray(16, 28), () => whole, "a Buffer"); }
{ class Bytes extends Uint8Array {} const buffer = new ArrayBuffer(64); const all = new Uint8Array(buffer); all.fill(4); over(new Bytes(buffer, 16, 12), () => all, "an heir of Uint8Array"); }
{ const buffer = new ArrayBuffer(64, { maxByteLength: 128 }); const all = new Uint8Array(buffer); over(new Uint8Array(buffer, 16), () => all, "a view that follows its buffer"); buffer.resize(24); over(globalThis.held, () => all, "the buffer made shorter"); }
{ const buffer = new ArrayBuffer(64); const view = new Uint8Array(buffer, 16, 12); structuredClone(buffer, { transfer: [buffer] }); over(view, () => new Uint8Array(2), "a view whose buffer has gone"); }
for (const [name, make] of [
  ["whole numbers", () => new Array(12).fill(0)], ["fractions", () => new Array(12).fill(0.5)], ["texts", () => new Array(12).fill("t")], ["empty", () => []], ["holes", () => { const l = new Array(12).fill(0); delete l[3]; return l; }],
  ["frozen", () => Object.freeze([1, 2, 3])], ["sealed", () => Object.seal([1, 2, 3])], ["an heir", () => new (class extends Array {})(12).fill(0)], ["a proxy", () => new Proxy(new Array(12).fill(0), {})],
  ["a plain object", () => ({})], ["an object with a length", () => ({ length: 3 })], ["arguments", () => (function () { return arguments; })(1, 2, 3)],
]) { const first = make(); const second = new Array(12).fill("second"); over(first, () => second, name); }
