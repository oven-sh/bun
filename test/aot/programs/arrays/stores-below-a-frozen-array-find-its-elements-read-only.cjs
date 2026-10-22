// A frozen array is the prototype of other objects. Its elements are read-only properties: a store under one of their indexes to an object below is refused,
// a store under any other index makes an own property, and the array itself goes on answering as before.
const lines = [];
function attempt(label, action) {
  let outcome;
  try { outcome = JSON.stringify(action()) ?? "undefined"; } catch (error) { outcome = error.constructor.name; }
  lines.push(label + ": " + outcome);
}
function storeSloppy(object, index, value) { object[index] = value; return [object[index], Object.hasOwn(object, index)]; }
function storeStrict(object, index, value) { "use strict"; object[index] = value; return [object[index], Object.hasOwn(object, index)]; }

const makers = {
  ints: () => Object.freeze([10, 20, 30]),
  doubles: () => Object.freeze([0.5, 1.5, 2.5]),
  texts: () => Object.freeze(["a", "b", "c"]),
  objects: () => Object.freeze([{ v: 1 }, { v: 2 }, { v: 3 }]),
  holes: () => Object.freeze([1, , 3]),
  empty: () => Object.freeze([]),
};
const children = {
  create: array => Object.create(array),
  literal: array => ({ __proto__: array }),
  literalWithFields: array => ({ __proto__: array, a: 1, b: 2 }),
  setPrototypeOf: array => Object.setPrototypeOf({}, array),
  withElements: array => Object.setPrototypeOf({ 5: "five" }, array),
  arrayWithHoles: array => Object.setPrototypeOf([, , , "own"], array),
  emptyArray: array => Object.setPrototypeOf([], array),
  instance: array => { function F() {} F.prototype = array; return new F(); },
  classInstance: array => { class C {} Object.setPrototypeOf(C.prototype, array); return new C(); },
  twoBelow: array => Object.create(Object.create(array)),
  functionBelow: array => Object.setPrototypeOf(function () {}, array),
};
for (const kind in makers) {
  for (const way in children) {
    const name = kind + ", " + way;
    for (const index of [0, 1, 2, 3, 7, "1", "x"]) {
      attempt(name + ", sloppy [" + index + "]", () => storeSloppy(children[way](makers[kind]()), index, "stored"));
      attempt(name + ", strict [" + index + "]", () => storeStrict(children[way](makers[kind]()), index, "stored"));
    }
    attempt(name + ", Reflect.set", () => { const child = children[way](makers[kind]()); return [Reflect.set(child, 0, 9), Reflect.set(child, 4, 9), Reflect.set(child, "length", 9), Object.keys(child)]; });
    attempt(name + ", defined", () => { const child = children[way](makers[kind]()); Object.defineProperty(child, 0, { value: "defined", enumerable: true }); return [child[0], Object.keys(child)]; });
    attempt(name + ", reads", () => { const array = makers[kind](); const child = children[way](array); return [child[0], child[1], child[2], child[3], child.length, 0 in child, 1 in child, Object.hasOwn(child, 0), Array.isArray(child), array.length, Object.isFrozen(array), array]; });
    attempt(name + ", the array afterwards", () => {
      const array = makers[kind](); const child = children[way](array);
      try { storeStrict(child, 0, 1); } catch {}
      try { storeStrict(array, 0, 1); } catch {}
      try { array.push(1); } catch {}
      try { array.x = 1; } catch {}
      return [array, array.length, Object.getOwnPropertyDescriptor(array, 0) ?? null, Object.getOwnPropertyDescriptor(array, "length"), Object.isFrozen(array), array.map(x => x).length, [...array].length, array.indexOf(array[2]), child[2] === array[2]];
    });
  }
}

// One array above many objects, and the objects made before and after the first store.
const shared = Object.freeze([1, 2, 3]);
const before = [];
for (let i = 0; i < 4; i++) before.push(Object.create(shared));
attempt("shared, the first", () => storeSloppy(before[0], 1, "x"));
for (let i = 0; i < 4; i++) before.push({ __proto__: shared });
for (let i = 0; i < before.length; i++) attempt("shared, " + i, () => [storeSloppy(before[i], i, "x"), Object.keys(before[i])]);
let total = 0;
for (let turn = 0; turn < 1000; turn++) for (let i = 0; i < shared.length; i++) total += shared[i];
lines.push("shared, read in a loop: " + total);

console.log(lines.join("\n"));
