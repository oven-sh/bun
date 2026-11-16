const holder = { made: null }; globalThis.heldForWitness = holder;
function hidden(v) { holder.made = v; return Reflect.get(globalThis, "heldForWitness").made; }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + ":" + String(o) : Object.getPrototypeOf(o) === null ? "null-proto " + JSON.stringify(o) : (Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name) + " " + JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join(); }
function Cell(a, b) { this.a = a; this.b = b; this.c = a; }
const C = hidden(Cell); const log = [];
console.log(show(new C(1, 2)));
Cell.prototype = { kind: "second", constructor: Cell }; console.log(show(new C(1, 2)), new C(1, 2).kind);
Cell.prototype = { set b(v) { log.push("set b " + v); }, get b() { return "from above"; }, constructor: Cell }; console.log(show(new C(3, 4)), new C(3, 4).b, log.join());
Cell.prototype = Object.freeze({ a: "frozen above", constructor: Cell }); console.log(show(new C(5, 6)), tried(() => (function () { "use strict"; return show(new C(5, 6)); })()));
Cell.prototype = Object.defineProperty({ constructor: Cell }, "c", { value: "read only above", writable: false }); console.log(show(new C(7, 8)), new C(7, 8).c);
Cell.prototype = 5; console.log(show(new C(9, 10)), Object.getPrototypeOf(new C(9, 10)) === Object.prototype);
Cell.prototype = null; console.log(show(new C(11, 12)));
Cell.prototype = new Proxy({ constructor: Cell }, { set(t, k, v, r) { log.push("trap " + String(k)); return Reflect.set(t, k, v, r); } }); console.log(show(new C(13, 14)), log.join());
function Late(a) { this.a = a; this.b = a + 1; }
const L = hidden(Late); let out = "";
for (let i = 0; i < 6; i++) { if (i === 3) Object.defineProperty(Late.prototype, "b", { set(v) { out += "[set " + v + "]"; }, get() { return "got"; }, configurable: true }); const o = new L(i); out += show(o) + " " + o.b + " | "; }
console.log(out); delete Late.prototype.b; console.log(show(new L(9)));
