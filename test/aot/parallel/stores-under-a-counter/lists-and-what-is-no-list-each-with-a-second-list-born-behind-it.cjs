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
for (const [name, make] of [
  ["whole numbers", () => new Array(12).fill(0)], ["fractions", () => new Array(12).fill(0.5)], ["texts", () => new Array(12).fill("t")], ["empty", () => []], ["holes", () => { const l = new Array(12).fill(0); delete l[3]; delete l[11]; return l; }],
  ["written", () => [1, 2, 3]], ["frozen", () => Object.freeze([1, 2, 3])], ["sealed", () => Object.seal([1, 2, 3])], ["closed", () => Object.preventExtensions([1, 2, 3])],
  ["a fixed length", () => Object.defineProperty([1, 2, 3], "length", { writable: false })], ["an heir", () => new (class extends Array {})(12).fill(0)],
  ["sparse", () => { const l = [0]; l[100000] = 1; l.length = 20; return l; }], ["a proxy", () => new Proxy(new Array(12).fill(0), {})],
  ["a plain object", () => ({})], ["an object with a length", () => ({ length: 3 })], ["arguments", () => (function () { return arguments; })(1, 2, 3)], ["a text object", () => new String("abc")],
]) { const first = make(); const second = new Array(12).fill("second"); over(first, () => second, name); }
for (const nothing of [null, undefined, 5, "text", true]) { globalThis.give = () => nothing; attempt("no object " + String(nothing), () => fill(1, 14), null); attempt("no object in a try " + String(nothing), () => fillInTry(1, 14), null); }
function fillEach(t, n, holders) { let b = holders[0]; for (let i = 0; i < n; i++) { b[i] = i + t; b = holders[i % holders.length]; } return holders.map(show).join(" "); }
console.log(fillEach(1, 14, [new Array(4).fill(0), new Uint8Array(6), {}, new Array(4).fill(0.5), new Float32Array(6)]));
