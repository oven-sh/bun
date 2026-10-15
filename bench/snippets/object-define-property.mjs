import { bench, run } from "../runner.mjs";

bench("defineProperty data descriptor {value, writable}", () => {
  const o = {};
  Object.defineProperty(o, "hey", { value: 42, writable: true });
  return o;
});

bench("defineProperty data descriptor (fully populated)", () => {
  const o = {};
  Object.defineProperty(o, "hey", { value: 42, writable: true, enumerable: true, configurable: true });
  return o;
});

const getter = function () {
  return 42;
};
const setter = function (value) {
  this._value = value;
};

bench("defineProperty accessor {get, set}", () => {
  const o = {};
  Object.defineProperty(o, "hey", { get: getter, set: setter });
  return o;
});

bench("defineProperty getter only", () => {
  const o = {};
  Object.defineProperty(o, "hey", { get: getter });
  return o;
});

bench("defineProperty 4 data properties", () => {
  const o = {};
  Object.defineProperty(o, "a", { value: 1, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(o, "b", { value: 2, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(o, "c", { value: 3, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(o, "d", { value: 4, writable: true, enumerable: true, configurable: true });
  return o;
});

await run();
