// Rest and spread copy: compiled answers as plain.
const src = {
  a: 1,
  get b() {
    return 2;
  },
  [Symbol.for("s")]: 3,
};
Object.defineProperty(src, "hidden", { value: 4 });
const copy = { ...src },
  { a, ...rest } = src;
console.log(
  JSON.stringify(copy),
  Object.getOwnPropertyDescriptor(copy, "b").value,
  copy[Symbol.for("s")],
  copy.hidden,
  Reflect.ownKeys(rest).length,
);
