// A refusal by kind names the class of an object that has no constructor, and looks at nothing that it holds.
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
