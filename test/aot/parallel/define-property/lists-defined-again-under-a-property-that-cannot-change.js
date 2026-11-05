// A second definition of a property that cannot be configured compares its value with the one that is there. Each evaluation of a written list is a list of its own, so these throw.
function attempt(label, run) {
  try {
    console.log(label, "no throw", String(run()));
  } catch (error) {
    console.log(label, "threw", error.name);
  }
}
function F() {
  this.a = 1;
}
const once = new F();
function again(v) {
  Object.defineProperty(once, "length", { value: [1, "e"], writable: false });
  return v;
}
attempt("one site, twice", () => {
  again(1);
  return again(2);
});

const plainObject = {};
function list() {
  return [1, 2, 3];
}
Object.defineProperty(plainObject, "x", { value: list() });
attempt("a list from one function", () => Object.defineProperty(plainObject, "x", { value: list() }));
const same = list();
const holder = {};
Object.defineProperty(holder, "x", { value: same });
attempt("the very same list", () => Object.defineProperty(holder, "x", { value: same }) === holder);

const inLoop = {};
attempt("in a loop", () => {
  for (let i = 0; i < 3; i++)
    Object.defineProperty(inLoop, "x", { value: [i & 0, "a"], writable: false, configurable: false });
});
const inLoopConstant = {};
attempt("a constant list in a loop", () => {
  for (let i = 0; i < 3; i++) Object.defineProperty(inLoopConstant, "x", { value: ["a", "b"] });
});
const reflected = {};
attempt("Reflect.defineProperty", () => {
  const answers = [];
  for (let i = 0; i < 2; i++) answers.push(Reflect.defineProperty(reflected, "x", { value: [1.5, 2.5] }));
  return answers.join();
});
const many = {};
attempt("Object.defineProperties", () => {
  for (let i = 0; i < 2; i++) Object.defineProperties(many, { x: { value: [true, false] } });
});
const descriptor = { value: ["kept", "here"] };
const byHeldDescriptor = {};
attempt("a descriptor that is kept", () => {
  for (let i = 0; i < 2; i++) Object.defineProperty(byHeldDescriptor, "x", descriptor);
});
function descriptorOf() {
  return { value: [7, 8] };
}
const byMadeDescriptor = {};
attempt("a descriptor that a function makes", () => {
  for (let i = 0; i < 2; i++) Object.defineProperty(byMadeDescriptor, "x", descriptorOf());
});
const nested = {};
attempt("a list of lists", () => {
  for (let i = 0; i < 2; i++) Object.defineProperty(nested, "x", { value: [[1], [2]] });
});
class Fields {
  n = 1;
}
const instance = new Fields();
attempt("an instance", () => {
  for (let i = 0; i < 2; i++) Object.defineProperty(instance, "n2", { value: [0, "z"] });
});
const frozen = Object.freeze({ x: [1, "e"] });
attempt("a frozen object", () => Object.defineProperty(frozen, "x", { value: [1, "e"] }));
attempt("the value read back", () => {
  const read = {};
  Object.defineProperty(read, "x", { value: [1, "e"] });
  return read.x === [1, "e"];
});
const fn = function () {};
attempt("a function's own property", () => {
  for (let i = 0; i < 2; i++) Object.defineProperty(fn, "held", { value: [1, 2] });
});
const accessor = {};
attempt("a getter of one function", () => {
  const get = () => [1, 2];
  for (let i = 0; i < 2; i++) Object.defineProperty(accessor, "x", { get });
});
const numbersInStrings = {};
attempt("numbers and text in a helper", () => {
  const define = () => Object.defineProperty(numbersInStrings, "x", { value: [1, "two", 3.5, null, undefined, true] });
  define();
  define();
});
