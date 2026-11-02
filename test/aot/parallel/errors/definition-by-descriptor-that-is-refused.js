// Object.defineProperty() with a descriptor written in the call: where the definition is refused, or runs other code, the stack has the frame of defineProperty where plain Bun has it, and that code runs once.
"use strict";
const opaque = value => [value, 0][Number(process.argv.length > 100)];
function framesOf(stack) {
  const frames = [];
  for (const text of String(stack).split("\n")) {
    const frame = /^\s*at (?:(.*?) \()?([^()]*?)(?::(\d+):(\d+))?\)?$/.exec(text);
    if (frame) frames.push((frame[1] ?? "") + "@" + frame[2].replace(/^.*[\\/]/, "") + (frame[3] ? ":" + frame[3] + ":" + frame[4] : ""));
  }
  return frames.slice(0, 4).join(" | ");
}
let runs = 0;
function attempt(label, run) {
  runs = 0;
  try {
    console.log(label, "-> no throw", JSON.stringify(run()), runs);
  } catch (error) {
    console.log(label, "->", error.name + ": " + error.message, framesOf(error.stack), runs);
  }
}
const fixed = () => Object.defineProperty({ kept: 1 }, "a", { value: 1 });
class Point { constructor() { this.x = 1; this.y = 2; } }

attempt("value of a fixed property", () => { Object.defineProperty(fixed(), "a", { value: opaque(2) }); });
attempt("constant value of a fixed property", () => { Object.defineProperty(fixed(), "a", { value: 2 }); });
attempt("the same value of a fixed property", () => Object.defineProperty(fixed(), "a", { value: opaque(1) }).a);
attempt("a fixed property becomes enumerable", () => { Object.defineProperty(fixed(), "a", { enumerable: true }); });
attempt("a fixed property becomes an accessor", () => { Object.defineProperty(fixed(), "a", { get: () => 1 }); });
attempt("a new name on a frozen literal", () => { Object.defineProperty(Object.freeze({ a: 1 }), "b", { value: opaque(2) }); });
attempt("a new name on a sealed literal", () => { Object.defineProperty(Object.seal({ a: 1 }), "b", { get: () => 1 }); });
attempt("a field of a frozen instance", () => { Object.defineProperty(Object.freeze(new Point()), "x", { value: opaque(2) }); });
attempt("a new name on an instance that takes none", () => { Object.defineProperty(Object.preventExtensions(new Point()), "z", { value: opaque(2) }); });
attempt("a field of an instance again", () => Object.defineProperty(new Point(), "x", { value: opaque(5), enumerable: false }));
attempt("an element of a frozen list", () => { Object.defineProperty(Object.freeze([1, 2]), "0", { value: opaque(2) }); });
attempt("an element of a list again", () => Object.defineProperty([1, 2], "0", { value: opaque(7) }));
attempt("the length of a list", () => { Object.defineProperty([1, 2], "length", { value: { valueOf() { runs++; return -1; } } }); });
attempt("the length of a list from an object", () => Object.defineProperty([1, 2, 3], "length", { value: { valueOf() { runs++; return 1; } } }));
attempt("the length of a list whose length is fixed", () => { Object.defineProperty(Object.freeze([1, 2]), "length", { value: opaque(1) }); });
attempt("a getter that is no function", () => { Object.defineProperty({}, "a", { get: opaque(5) }); });
attempt("a setter that is no function", () => { Object.defineProperty({}, "a", { set: opaque("text") }); });
attempt("the prototype of a class", () => { Object.defineProperty(Point, "prototype", { value: opaque({}) }); });
attempt("the name of a function", () => Object.defineProperty(function before() {}, "name", { value: opaque("after") }).name);
attempt("an element of bytes", () => { Object.defineProperty(new Uint8Array(2), "0", { value: { valueOf() { runs++; return 3; } }, configurable: false }); });
attempt("an element past the end of bytes", () => { Object.defineProperty(new Uint8Array(2), "5", { value: opaque(1) }); });
attempt("a trap that answers false", () => { Object.defineProperty(new Proxy({}, { defineProperty() { runs++; return false; } }), "a", { value: opaque(1) }); });
attempt("a trap that answers false for an empty descriptor", () => { Object.defineProperty(new Proxy({}, { defineProperty() { runs++; return false; } }), "a", {}); });
attempt("a trap that answers true", () => typeof Object.defineProperty(new Proxy({}, { defineProperty(target, key, descriptor) { runs++; return Reflect.defineProperty(target, key, descriptor); } }), "a", { value: opaque(1) }));
attempt("a trap that throws", () => { Object.defineProperty(new Proxy({}, { defineProperty() { runs++; throw new Error("from the trap"); } }), "a", { value: opaque(1) }); });
attempt("a trap that sees the descriptor", () => { let seen; Object.defineProperty(new Proxy({}, { defineProperty(target, key, descriptor) { runs++; seen = descriptor; return true; } }), "a", { value: opaque(1), writable: true }); return seen; });
attempt("a revoked proxy", () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); Object.defineProperty(proxy, "a", { value: opaque(1) }); });
class Shape { static sides = 4; area() { return 1; } }
attempt("a list is cut short down to an element that stays", () => { const list = [1, 2, 3, 4]; Object.defineProperty(list, "1", { value: 2, configurable: false }); try { Object.defineProperty(list, "length", { value: opaque(0) }); } finally { console.log(JSON.stringify(list), list.length); } });
attempt("the length of a list is a fraction", () => { Object.defineProperty([1, 2], "length", { value: opaque(1.5) }); });
attempt("the length of a list stops being writable", () => Object.getOwnPropertyDescriptor(Object.defineProperty([1, 2], "length", { writable: false }), "length"));
attempt("the length of a function", () => Object.defineProperty(function (a, b) {}, "length", { value: opaque(5) }).length);
attempt("the length of a frozen function", () => { Object.defineProperty(Object.freeze(function (a, b) {}), "length", { value: opaque(5) }); });
attempt("the prototype of a function stops being writable", () => Object.getOwnPropertyDescriptor(Object.defineProperty(function () {}, "prototype", { writable: false }), "prototype").writable);
attempt("the prototype of an arrow function", () => Object.defineProperty(() => 1, "prototype", { value: opaque(3) }).prototype);
attempt("the name of a frozen bound function", () => { Object.defineProperty(Object.freeze(fixed.bind(null)), "name", { value: opaque("other") }); });
attempt("a static member again", () => Object.defineProperty(Shape, "sides", { value: opaque(3) }).sides);
attempt("a method of a class again", () => Object.defineProperty(Shape.prototype, "area", { value: () => opaque(2) }).area());
attempt("a static member of a frozen class", () => { Object.defineProperty(Object.freeze(Shape), "sides", { value: opaque(5) }); });
attempt("a method of a class whose prototype is frozen", () => { Object.defineProperty(Object.freeze(Shape.prototype), "area", { value: () => 3 }); });
attempt("the name of a built-in function's copy", () => { Object.defineProperty(Object.freeze(Math.max.bind(Math)), "length", { value: opaque(9) }); });
