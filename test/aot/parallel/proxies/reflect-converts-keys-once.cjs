"use strict";
let converted = 0;
const key = {
  toString() {
    converted++;
    return "x";
  },
};
const primitive = {
  [Symbol.toPrimitive](hint) {
    converted++;
    return hint === "string" ? "x" : 0;
  },
};
const bound = { toString: () => (converted++, Symbol.iterator) };
function count(work) {
  converted = 0;
  let answer;
  try {
    answer = work();
  } catch (error) {
    answer = error.name;
  }
  return `${converted} ${typeof answer === "object" ? "object" : String(answer)}`;
}
class Point {
  x = 1;
  y = 2;
}
const objects = () => [
  { x: 1 },
  new Point(),
  [1, 2],
  Object.assign([1], { x: 1 }),
  { y: 1 },
  new Proxy({ x: 1 }, {}),
  { set x(value) {} },
  Object.freeze({ x: 1 }),
  Object.create({ x: 1 }),
  Object.assign(Object.create(null), { x: 1, [Symbol.iterator]: 2 }),
  new Uint8Array(2),
];
for (let round = 0; round < 3; round++) {
  for (const each of [key, primitive, bound, "x", Symbol.iterator, 1n, 0]) {
    for (const object of objects()) {
      console.log(
        count(() => Reflect.get(object, each)),
        count(() => Reflect.set(object, each, 3)),
        count(() => Reflect.set(object, each, 4, object)),
        count(() => Reflect.set(object, each, 5, new Proxy(object, {}))),
        count(() => Reflect.set(object, each, 6, {})),
        count(() => Reflect.has(object, each)),
        count(() => Reflect.getOwnPropertyDescriptor(object, each)),
        count(() => Reflect.defineProperty(object, each, { value: 7, configurable: true, writable: true })),
        count(() => Reflect.deleteProperty(object, each)),
        Object.keys(object).join(),
      );
    }
  }
}
