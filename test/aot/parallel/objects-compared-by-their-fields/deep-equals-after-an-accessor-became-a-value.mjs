// Bun.deepEquals compares an object that had an accessor with the enumerable names above it, also after a value replaced the accessor.
import { isDeepStrictEqual } from "node:util";

const base = {
  own: 1,
  get name() {
    return "got";
  },
};
function withoutSetter() {
  const object = Object.setPrototypeOf({ n: 1, set x(value) {} }, base);
  Object.defineProperty(object, "x", { value: undefined, enumerable: true });
  return object;
}
function withoutSetterOrPrototype() {
  const object = Object.setPrototypeOf({ n: 1, set x(value) {} }, null);
  Object.defineProperty(object, "x", { value: undefined, enumerable: true });
  return object;
}
const others = {
  plain: () => Object.assign(Object.create(base), { n: 1 }),
  bare: () => ({ n: 1 }),
  other: () => Object.setPrototypeOf({ n: 1 }, { own: 2 }),
  wide: () => ({ n: 1, own: 1, name: "got" }),
};
for (const make of [withoutSetter, withoutSetterOrPrototype]) {
  const elsewhere = () => Object.setPrototypeOf(make(), { own: 3 });
  for (const [which, other] of Object.entries({ ...others, same: make, elsewhere })) {
    const a = make();
    const b = other();
    console.log(make.name, which, Bun.deepEquals(a, b), Bun.deepEquals(b, a), Bun.deepEquals(a, b, true), isDeepStrictEqual(a, b));
  }
}
