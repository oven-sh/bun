// A refusal by kind prints an object that is not plain and has no constructor as the formatter does.
const shapes = [
  Object.setPrototypeOf(new Map([[1, 2]]), null),
  Object.setPrototypeOf(new Map(), Object.create(null)),
  Object.setPrototypeOf(new Set([1]), null),
  Object.setPrototypeOf([1, 2], null),
  Object.setPrototypeOf(new Date(0), null),
  Object.setPrototypeOf(new Uint16Array(2), null),
  Object.setPrototypeOf(Promise.resolve(1), null),
  Object.create(null),
  { __proto__: null, held: 1 },
  new Map(),
];
for (const shape of shapes) {
  try {
    queueMicrotask(shape);
  } catch (error) {
    console.log(`${error.code} ${error.message}`);
  }
}
