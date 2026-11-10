// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk as users build it, and every raw store asks its position at the run.
"use strict";
function show(x) { if (ArrayBuffer.isView(x)) return x.constructor.name + "[" + Array.prototype.join.call(x, ",") + "]"; if (Array.isArray(x)) return "list " + x.length + "[" + x.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(",") + "]"; return "object " + JSON.stringify(x); }
function fill(t, n) { const b = globalThis.give(); for (let i = 0; i < n; i++) b[i] = i + t; return b; }
function fillHeld(t, n) { const b = globalThis.held; for (let i = 0; i < n; i++) b[i] = i + t; return b; }
function fillWith(t, n, between) { const b = globalThis.give(); for (let i = 0; i < n; i++) { between(i, b); b[i] = i + t; } return b; }
function fillInTry(t, n) { const b = globalThis.give(); let turns = 0; try { for (let i = 0; i < n; i++) { b[i] = i + t; turns++; } } catch (error) { return error.constructor.name + " behind " + turns + " " + show(b); } return b; }
function attempt(name, run, beside) { let said; try { const given = run(); said = typeof given === "string" ? given : show(given); } catch (error) { said = error.constructor.name + ": " + error.message; } console.log(name, said, "| beside:", beside ? show(beside()) : "-"); }
function over(made, beside, name) {
  globalThis.give = () => made; globalThis.held = made;
  attempt(name + " given", () => fill(0.5, 14), beside); attempt(name + " given whole", () => fill(3, 14), beside); attempt(name + " held", () => fillHeld(7, 14), beside); attempt(name + " in a try", () => fillInTry(9, 14), beside);
}
{ const buffer = new ArrayBuffer(96); const all = new Uint8Array(buffer); all.fill(200); for (const kind of [Uint8Array, Int8Array, Uint8ClampedArray]) over(new kind(buffer, 32, 12), () => all, kind.name); }
{ const buffer = new ArrayBuffer(256); const all = new Uint8Array(buffer); all.fill(9); for (const kind of [Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) over(new kind(buffer, 64, 12), () => all, kind.name); }
{ const whole = Buffer.alloc(64, 7); over(whole.subarray(16, 28), () => whole, "a Buffer"); }
{ const buffer = new ArrayBuffer(8192); const all = new Uint8Array(buffer); all.fill(5); const view = new Uint8Array(buffer, 2048, 4000); globalThis.give = () => view; fill(1, 4010); let sum = 0; for (const x of all) sum += x; console.log(sum, all[2047], all[2048], all[6047], all[6048]); }
