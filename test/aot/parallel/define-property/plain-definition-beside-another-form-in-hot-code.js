// Hot code inlines the callbacks into the constructor, so a definition with every attribute true meets a fresh object whose field `k` is planned with other attributes.
function AllFalse(fill) {
  fill(this);
}
function Quiet(fill) {
  fill(this);
}
function Fixed(fill) {
  fill(this);
}
function make(turn) {
  return [
    new AllFalse((made) => { Object.defineProperty(made, "k", { value: 1 }); }),
    new AllFalse((made) => { Object.defineProperty(made, "k", { value: turn, writable: true, enumerable: true, configurable: true }); }),
    new Quiet((made) => { Object.defineProperty(made, "k", { value: 1, writable: true, configurable: true }); }),
    new Quiet((made) => { Object.defineProperty(made, "k", { value: turn, writable: true, enumerable: true, configurable: true }); }),
    new Fixed((made) => { Object.defineProperty(made, "k", { value: 1, enumerable: true, configurable: true }); }),
    new Fixed((made) => { Object.defineProperty(made, "k", { value: turn, writable: true, enumerable: true, configurable: true }); }),
  ];
}
let last;
for (let turn = 0; turn < 100000; turn++) last = make(turn);
const attempt = (action) => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
};
for (const object of last)
  console.log(object.constructor.name, JSON.stringify(Object.getOwnPropertyDescriptor(object, "k")), Object.keys(object).join(), JSON.stringify(object), attempt(() => (object.k = -1)), object.k, attempt(() => delete object.k), "k" in object);
