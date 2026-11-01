// Each line spreads a typed array of 268,435,457 elements, one more than a list holds, and prints what is thrown.
const long = new Int8Array(268435457);
function take() {
  return arguments.length;
}
class Taker {
  constructor() {
    this.count = arguments.length;
  }
}
class Derived extends Taker {
  constructor(list) {
    super(...list);
  }
}
const holder = { take };
function callLast(list) {
  "use strict";
  return take(...list);
}
function attempt(name, run) {
  try {
    console.log(name, run(long));
  } catch (error) {
    console.log(name, error.constructor.name + ": " + error.message);
  }
}
attempt("call", () => take(...long));
attempt("call of a parameter", list => take(...list));
attempt("method", list => holder.take(...list));
attempt("optional call", list => take?.(...list));
attempt("new", list => new Taker(...list).count);
attempt("super", list => new Derived(list).count);
attempt("last call", list => callLast(list));
attempt("literal", () => [...long].length);
attempt("literal of a parameter", list => [...list].length);
attempt("behind an element", list => [0, ...list].length);
attempt("in front of an element", list => [...list, 0].length);
attempt("twice", list => take(...list, ...list));
attempt("behind arguments", list => take(1, 2, ...list));
attempt("Function.prototype.call", list => take.call(null, ...list));
attempt("Function.prototype.bind", list => take.bind(null, ...list)());
attempt("Math.max", list => Math.max(...list));
attempt("String.fromCharCode", list => String.fromCharCode(...list).length);
attempt("push", list => [].push(...list));
attempt("Array.of", list => Array.of(...list).length);
attempt("new Array", list => new Array(...list).length);
attempt("unsigned bytes of the same buffer", list => take(...new Uint8Array(list.buffer)));
attempt("clamped bytes of the same buffer", list => [...new Uint8ClampedArray(list.buffer)].length);
attempt("a part that fits", list => take(...list.subarray(0, 5)));
attempt("words of the same buffer", list => [...new Int32Array(list.buffer, 0, 3)].length);
attempt("apply", list => take.apply(null, list));
attempt("Reflect.apply", list => Reflect.apply(take, null, list));
attempt("Reflect.construct", list => Reflect.construct(Taker, list).count);
globalThis.kept = long;
const readBack = () => globalThis["ke" + "pt"];
attempt("call of a value read back by a joined name", () => take(...readBack()));
attempt("new of such a value", () => new Taker(...readBack()).count);
attempt("literal of such a value", () => [...readBack()].length);
for (const one of [new Set([1, 2]), new Map([[1, 2]]), "abc", [1, 2, 3, 4], take, 5, long]) {
  attempt("one of many kinds", () => take(...one));
}
class Walked extends Int8Array {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
  }
}
attempt("a class of its own that walks otherwise", () => take(...new Walked(long.buffer)));
let steps = 0;
attempt("what stands behind it is not evaluated", list => take(...list, steps++));
console.log("steps", steps);
