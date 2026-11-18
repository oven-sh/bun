// A descriptor written in place that says yes to everything defines what a field of a literal or of a class is defined by. Where the field has no slot that compiled code may write in line,
// the definition goes by the stub of definitions and not into the run time at every call. What it answers, refuses and throws is what Object.defineProperty() answers, refuses and throws.
// COUNT: operation:operationAOTDefineOwnProperty <= 8
function beside(i) { const o = { a: i }; Object.defineProperty(o, "n", { value: i + 1, enumerable: true, writable: true, configurable: true }); return o; }
let sum = 0;
for (let i = 0; i < 3000; i++) { const o = beside(i); sum += o.n - o.a + Object.keys(o).length; }
console.log(sum, JSON.stringify(beside(4)), JSON.stringify(Object.getOwnPropertyDescriptor(beside(5), "n")));

function lay(o, v) { return Object.defineProperty(o, "n", { value: v, enumerable: true, writable: true, configurable: true }); }
function tell(name, o, v) {
  try { const back = lay(o, v); console.log(name, back === o, JSON.stringify(Object.getOwnPropertyDescriptor(o, "n")), Object.keys(o).join()); }
  catch (e) { console.log(name, e.constructor.name, e.message, JSON.stringify(Object.getOwnPropertyDescriptor(o, "n"))); }
}
tell("fresh", { a: 1 }, 1);
const twice = { a: 1 }; tell("first", twice, 1); tell("again", twice, 2);
tell("over a hidden one", Object.defineProperty({ a: 1 }, "n", { value: 0, configurable: true }), 3);
tell("over a getter", Object.defineProperty({ a: 1 }, "n", { get() { return 9; }, configurable: true }), 4);
tell("over a locked one", Object.defineProperty({ a: 1 }, "n", { value: 0 }), 5);
tell("frozen", Object.freeze({ a: 1 }), 6);
tell("sealed", Object.seal({ a: 1 }), 7);
tell("closed", Object.preventExtensions({ a: 1 }), 8);
tell("below a setter", Object.create({ set n(v) { console.log("the setter above is asked, and must not be"); } }), 9);
tell("below a read-only one", Object.create(Object.freeze({ n: 0 })), 10);
tell("a list", [1, 2], 11);
tell("a function", function named() {}, 12);
tell("a class", class Named {}, 13);
tell("a map", new Map(), 14);
const seen = [];
tell("a proxy", new Proxy({ a: 1 }, { defineProperty(target, key, descriptor) { seen.push(key, JSON.stringify(descriptor)); return Reflect.defineProperty(target, key, descriptor); } }), 15);
console.log(seen.join(" "));
tell("a proxy that says no", new Proxy({ a: 1 }, { defineProperty() { return false; } }), 16);
function length(o, v) { try { Object.defineProperty(o, "length", { value: v, enumerable: true, writable: true, configurable: true }); return "laid " + o.length; } catch (e) { return e.constructor.name + " " + e.message; } }
console.log(length([1, 2, 3], 1), "|", length({ a: 1 }, 1), "|", length(function two(a, b) {}, 7));
function layOnWhatIsNoObject(o, v) { return Object.defineProperty(o, "n", { value: v, enumerable: true, writable: true, configurable: true }); }
for (const nothing of [1, "text", null, undefined, true]) { try { layOnWhatIsNoObject(nothing, 1); console.log("laid on", nothing); } catch (e) { console.log(e.constructor.name, e.message); } }
