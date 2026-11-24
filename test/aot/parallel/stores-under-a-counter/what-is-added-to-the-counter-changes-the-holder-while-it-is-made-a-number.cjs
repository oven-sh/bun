// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (ArrayBuffer.isView(x)) return x.constructor.name + " " + x.length + "[" + Array.prototype.join.call(x, ",") + "]"; return "list " + x.length + "[" + x.join(",") + "]"; }
function fill(t, n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i + t; return b[3] & 255; }
function acting(at, act) { let calls = 0; return { valueOf() { if (calls++ === at) act(); return 1; } }; }
function attempt(name, made, act, beside) { globalThis.held = made; for (let warm = 0; warm < 3; warm++) fill(1, 4); let said; try { said = String(fill(acting(5, act), 14)); } catch (error) { said = error.constructor.name; } console.log(name, said, show(made), "| beside:", show(beside())); }
{ const buffer = new ArrayBuffer(64, { maxByteLength: 128 }); const all = new Uint8Array(buffer); attempt("made shorter", new Uint8Array(buffer, 8), () => buffer.resize(12), () => all); }
{ const buffer = new ArrayBuffer(64, { maxByteLength: 128 }); const all = new Uint8Array(buffer); attempt("made shorter under a fixed length", new Uint8Array(buffer, 8, 12), () => buffer.resize(12), () => all); }
{ const buffer = new ArrayBuffer(16, { maxByteLength: 128 }); const all = new Uint8Array(buffer); attempt("made longer", new Uint8Array(buffer, 8), () => buffer.resize(64), () => all); }
{ const buffer = new ArrayBuffer(64); attempt("gone", new Uint8Array(buffer, 8, 12), () => { structuredClone(buffer, { transfer: [buffer] }); }, () => new Uint8Array(2)); }
{ const buffer = new ArrayBuffer(128); attempt("gone under fractions", new Float64Array(buffer, 8, 12), () => { structuredClone(buffer, { transfer: [buffer] }); }, () => new Uint8Array(2)); }
{ const other = new Uint8Array(4); const buffer = new ArrayBuffer(64); const all = new Uint8Array(buffer); attempt("the name finds another", new Uint8Array(buffer, 8, 12), () => { globalThis.held = other; }, () => all); console.log(show(other)); }
{ const made = new Array(12).fill(0); const second = new Array(12).fill(9); attempt("a list cut", made, () => { made.length = 2; }, () => second); }
{ const made = new Array(12).fill(0); const second = new Array(12).fill(9); attempt("a list frozen", made, () => { Object.freeze(made); }, () => second); }
{ const made = new Array(12).fill(0); const second = new Array(12).fill(9); attempt("a list takes a text", made, () => { made[0] = "text"; }, () => second); }
