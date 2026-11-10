// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(String).join(",") + "]"; return "object " + JSON.stringify(x); }
function fillTrue(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = true; }
function fillFalse(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = false; }
function fillCompared(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i > 3; }
function fillOrUndefined(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i & 1 ? i > 3 : undefined; }
function fillOrNull(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i & 1 ? i > 3 : null; }
function fillObject(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = new Boolean(i > 3); }
function fillOrNumber(n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i & 1 ? i > 3 : i + 0.5; }
function attempt(name, run, beside) { let said = "done"; try { run(14); } catch (error) { said = error.constructor.name; } console.log(name, run.name, said, show(globalThis.held), "| beside:", show(beside())); }
const fills = [fillTrue, fillFalse, fillCompared, fillOrUndefined, fillOrNull, fillObject, fillOrNumber];
for (const kind of [Uint8Array, Uint8ClampedArray, Int16Array, Float32Array, Float64Array, BigInt64Array]) for (const run of fills) { const buffer = new ArrayBuffer(256); const all = new Uint8Array(buffer); all.fill(9); globalThis.held = new kind(buffer, 64, 12); attempt(kind.name, run, () => all); }
for (const run of fills) { const whole = Buffer.alloc(40, 7); globalThis.held = whole.subarray(8, 20); attempt("a Buffer", run, () => whole); }
for (const [name, make] of [["whole numbers", () => new Array(12).fill(0)], ["fractions", () => new Array(12).fill(0.5)], ["booleans", () => new Array(12).fill(false)], ["empty", () => []], ["frozen", () => Object.freeze([1, 2, 3])], ["a plain object", () => ({})]])
  for (const run of fills) { globalThis.held = make(); const second = new Array(4).fill("second"); attempt(name, run, () => second); }
