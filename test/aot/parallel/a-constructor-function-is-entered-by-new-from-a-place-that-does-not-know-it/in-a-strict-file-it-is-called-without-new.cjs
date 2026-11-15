"use strict";
const holder = { made: null }; globalThis.heldForWitness = holder;
function hidden(v) { holder.made = v; return Reflect.get(globalThis, "heldForWitness").made; }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + ":" + String(o) : Object.getPrototypeOf(o) === null ? "null-proto " + JSON.stringify(o) : (Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name) + " " + JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join(); }
function Strict(a) { this.a = a; this.b = a + 1; }
const X = hidden(Strict);
console.log(show(new X(1)), tried(() => X(2)), tried(() => show((X.call({ own: 1 }, 3), 0))));
const list = [1]; X.apply(list, [5]); console.log(list.a, list.b, list.length);
console.log(tried(() => X.call(5, 6)), tried(() => X.call(null, 6)), tried(() => X.call(Object.freeze({}), 7)), tried(() => X.call(Object.defineProperty({}, "a", { value: 1 }), 8)));
for (let i = 0; i < 3; i++) console.log(show(new X(i)), tried(() => X(i)));
