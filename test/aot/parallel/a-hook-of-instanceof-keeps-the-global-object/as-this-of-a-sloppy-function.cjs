// A Symbol.hasInstance method gets the tested object itself, here the global object as a sloppy function's `this`, and may read any member of it.
const kept = [];
class Own {
  static [Symbol.hasInstance](value) {
    return kept.push(value) > 0;
  }
}
function Other() {}
Object.defineProperty(Other, Symbol.hasInstance, { value: value => kept.push(value) > 0 });
function ask() {
  return this instanceof Own;
}
console.log((0, ask)(), (function () { return this instanceof Other || 0; })());
for (const value of kept) console.log(value === globalThis, typeof value[["proc", "ess"].join("")].finalization);
