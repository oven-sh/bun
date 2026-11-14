// answers: with-library
// # An element that is read or stored under a constant index of a receiver of any kind.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 169 of 169 of 169
// # CHECK-NEXT: exited with 0
function read(receiver) { return receiver[2]; }
function readFar(receiver) { return receiver[200]; }
function write(receiver, value) { "use strict"; receiver[2] = value; return receiver; }
function writeFar(receiver, value) { "use strict"; receiver[200] = value; return receiver; }
function writeSloppy(receiver, value) { receiver[2] = value; return receiver; }
function tryTo(action) { try { return action(); } catch (error) { return error.name; } }
function show(value) { return Array.isArray(value) ? "[" + Array.prototype.map.call(Array.from(value), show).join("|") + "]" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value); }
const long = new Array(250).fill("x");
const receivers = [ ["a", "b", "c"], [1, 2, 3], [0.5, 1.5, 2.5], ["a"], [, , "c"], ["a", "b", , "d"], new Array(5), long, "abc", "ab", new String("xyz"), new Int8Array([1, 2, 3]), new Float64Array([1.5, 2.5, 3.5]), new Uint8ClampedArray(3), new Uint8Array(1), { 0: "o", 2: "two" }, {}, new Map(), 5, true, 10n, Symbol.iterator, null, undefined, () => 1, (function () { return arguments; })(1, 2, 3), Object.freeze(["f", "g", "h"]), Object.seal([1, 2, 3]), new Proxy(["p", "q", "r"], { get(target, key) { return "trap " + String(key); } }), Object.defineProperty(["a", "b", "c"], 2, { get() { return "got"; } }), Object.create({ 2: "inherited" }), new (class extends Array {})("u", "v", "w"), new Date(0), ];
for (const receiver of receivers) { report(show(tryTo(() => read(receiver))) + " " + show(tryTo(() => readFar(receiver)))); }
for (const make of [ () => ["a", "b", "c"], () => [1, 2, 3], () => [0.5, 1.5, 2.5], () => ["a"], () => [], () => [, , "c"], () => new Array(5), () => new Array(250).fill(0), () => new Int8Array(3), () => new Float64Array(3), () => new Uint8ClampedArray(3), () => new Uint8Array(1), () => ({ 0: "o" }), () => new Map(), () => 5, () => "abc", () => null, () => undefined, () => (function () { return arguments; })(1, 2, 3), () => Object.freeze(["f", "g", "h"]), () => Object.preventExtensions(["f"]), () => Object.defineProperty(["a", "b", "c"], 2, { set(value) { this[0] = value; } }), () => Object.defineProperty(["a", "b", "c"], 2, { writable: false }), () => new (class extends Array {})("u", "v", "w"), () => new Proxy(["p", "q", "r"], { set(target, key, value) { target[0] = String(key) + String(value); return true; } }), () => new Proxy(["p", "q", "r"], { set() { return false; } }), () => Object.create(["a", "b", "c"]), ]) { for (const value of [7, "text", 1.5, undefined, { deep: 1 }]) { const answers = [write, writeFar, writeSloppy].map(store => { const receiver = make(); const result = tryTo(() => store(receiver, value)); return typeof result === "string" ? result : show(result === null || result === undefined ? result : result[2]) + "," + show(tryTo(() => result[200])) + "," + show(tryTo(() => result.length)) + "," + show(tryTo(() => result[0])); }); report(answers.join(" ; ")); } }
report("end");
