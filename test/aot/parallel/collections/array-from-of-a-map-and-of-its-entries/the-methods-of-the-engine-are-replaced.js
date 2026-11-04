// Map.prototype[Symbol.iterator], Map.prototype.entries, `next` of the iterators' prototype and the method above every iterator: each is put in the place of the engine's own between two calls, and taken away again.
// Built-in objects are read-only in a compiled executable: each store and each definition throws, and the copies stay what they were. Plain Bun takes them, and copies by them.
const map = new Map([["a", 1], ["b", 2]]);
function copies() { return JSON.stringify(Array.from(map)) + " " + JSON.stringify(Array.from(map.entries())) + " " + JSON.stringify([...map.entries()]); }
const iterators = Object.getPrototypeOf(new Map().entries());
const places = [[Map.prototype, Symbol.iterator, function () { return [["the method of Maps is replaced"]].values(); }], [Map.prototype, "entries", function () { return [["entries is replaced"]].values(); }], [iterators, "next", function () { return { done: true }; }], [Object.getPrototypeOf(iterators), Symbol.iterator, function () { return [["the method above every iterator is replaced"]].values(); }]];
for (let turn = 0; turn < 2; turn++) {
  console.log(copies());
  for (const [holder, key, replacement] of places) {
    const own = holder[key];
    try { holder[key] = replacement; console.log("replaced:", String(key)); } catch (error) { console.log(error.constructor.name + ":", String(key)); }
    console.log(copies());
    try { holder[key] = own; } catch {}
    try { Object.defineProperty(holder, key, { value: replacement, configurable: true, writable: true }); console.log("defined:", String(key)); } catch (error) { console.log(error.constructor.name + ":", String(key)); }
    console.log(copies());
    try { Object.defineProperty(holder, key, { value: own, configurable: true, writable: true }); } catch {}
    console.log(copies());
  }
}
/* Output:
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: entries
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: entries
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: next
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: next
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: entries
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: entries
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: next
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: next
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
TypeError: Symbol(Symbol.iterator)
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
[["a",1],["b",2]] [["a",1],["b",2]] [["a",1],["b",2]]
*/
