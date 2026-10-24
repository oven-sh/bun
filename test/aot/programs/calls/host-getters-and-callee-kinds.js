// Getters that the engine implements natively, read from values of no type; and values of no type called with none to three arguments: closures with and without captured variables, native functions,
// the native getter of a built-in taken as a function, bound functions with none to three bound arguments (of closures, of native functions, of bound functions), class constructors (which throw), proxies of functions, and what is no function.
const lines = [];
function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
const holders = [new Uint8Array(6), new Float64Array(2), new ArrayBuffer(5), new DataView(new ArrayBuffer(7), 2), new Map([[1, 2]]), new Set([1, 2, 3]), Symbol("described"), /a+/giu, new Uint8Array(new ArrayBuffer(16), 4, 8)];
const names = ["byteLength", "byteOffset", "length", "size", "description", "flags", "source", "global", "buffer"];
function get(o, k) { switch (k) { case 0: return o.byteLength; case 1: return o.byteOffset; case 2: return o.length; case 3: return o.size; case 4: return o.description; case 5: return o.flags; case 6: return o.source; case 7: return o.global; default: return o.buffer === undefined ? undefined : o.buffer.byteLength; } }
for (let round = 0; round < 3; round++) {
  const rows = holders.map((o) => names.map((_, k) => String(get(o, k))).join());
  if (round === 2) lines.push(...rows);
}
const own = { get viaClosure() { return this === own ? "own" : "other"; } };
Object.defineProperty(own, "viaNative", { get: Object.getOwnPropertyDescriptor(Map.prototype, "size").get, configurable: true });
Object.defineProperty(own, "viaBound", { get: function () { return this.tag; }.bind({ tag: "bound this" }), configurable: true });
lines.push([attempt(() => own.viaClosure), attempt(() => own.viaNative), attempt(() => own.viaBound), attempt(() => Object.create(own).viaClosure)].join());
let captured = 10;
const plain = function (a, b, c) { return [this === undefined ? "u" : typeof this, a, b, c].join("/"); };
const capturing = (a, b, c) => [captured, a, b, c].join("/");
const withProperty = Math.max; const decorated = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
class Klass { constructor() { this.x = 1; } }
const callees = [plain, capturing, withProperty, decorated, String, parseInt, Array.isArray, plain.bind("t"), plain.bind("t", 1), plain.bind("t", 1, 2), plain.bind("t", 1, 2, 3), plain.bind("t", 1, 2, 3, 4), Math.max.bind(null, 5), Math.max.bind(null).bind(null, 7), capturing.bind(null, "c"),
  Function.prototype.call.bind(plain), Function.prototype.call.bind(Math.max), Klass, new Proxy(plain, {}), new Proxy(Math.max, {}), function () { return arguments.length; }, (...rest) => rest.length, async (a) => a, function* () {}, undefined, null, 5, "text", {}, []];
function call0(f) { return f(); } function call1(f, a) { return f(a); } function call2(f, a, b) { return f(a, b); } function call3(f, a, b, c) { return f(a, b, c); }
for (let round = 0; round < 3; round++) {
  const rows = callees.map((f) => [attempt(() => call0(f)), attempt(() => call1(f, 3)), attempt(() => call2(f, 3, 4)), attempt(() => call3(f, 3, 4, 9))].join(" | "));
  if (round === 2) lines.push(...rows);
}
console.log(lines.join("\n"));
