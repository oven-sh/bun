// A frozen array keeps its dense storage until it becomes a prototype. Each function reads the array, makes it a prototype, and reads it again.
const lines = [];
function report(label, ...values) {
  lines.push(label + ": " + values.map(value => (typeof value === "string" ? value : JSON.stringify(value) ?? String(value))).join(" "));
}

const waysToBecomePrototype = {
  setPrototypeOf(array) { return Object.setPrototypeOf({}, array); },
  reflectSetPrototypeOf(array) { const o = {}; Reflect.setPrototypeOf(o, array); return o; },
  create(array) { return Object.create(array); },
  literal(array) { return { __proto__: array }; },
  protoSetter(array) { const o = {}; o.__proto__ = array; return o; },
  functionPrototype(array) { function F() {} F.prototype = array; return new F(); },
  classPrototypeParent(array) { class C {} Object.setPrototypeOf(C.prototype, array); return new C(); },
};

function readInts(array, become) {
  let before = 0;
  for (let i = 0; i < array.length; i++) before += array[i];
  const child = become(array);
  let after = 0;
  for (let i = 0; i < array.length; i++) after += array[i];
  return [before, after, array[0], array[array.length - 1], child[1], array.length, Object.isFrozen(array)];
}
for (const name in waysToBecomePrototype) {
  report("ints, " + name, readInts(Object.freeze([10, 20, 30, 40]), waysToBecomePrototype[name]));
  report("doubles, " + name, readInts(Object.freeze([1.5, 2.5, 3.5]), waysToBecomePrototype[name]));
}

function readTexts(array, become) {
  let before = "";
  for (const text of array) before += text;
  const child = become(array);
  let after = "";
  for (const text of array) after += text;
  return [before, after, array.join("-"), array.indexOf("c"), array.includes("b"), array.map(text => text + text).length, array.slice(1), child[0], [...array].length];
}
for (const name in waysToBecomePrototype)
  report("texts, " + name, readTexts(Object.freeze(["a", "b", "c"]), waysToBecomePrototype[name]));

// The way is written out, so that the compiler sees which built-in runs between the reads.
const constantInts = Object.freeze([1, 2, 3]);
function constantThroughSetPrototypeOf(target) {
  let total = constantInts[0] + constantInts[1] + constantInts[2];
  Object.setPrototypeOf(target, constantInts);
  total += (constantInts[0] + constantInts[1] + constantInts[2]) * 100;
  return total;
}
report("a constant, Object.setPrototypeOf", constantThroughSetPrototypeOf({}), constantThroughSetPrototypeOf({}));

const constantDoubles = Object.freeze([0.5, 1.5, 2.5]);
function constantThroughCreate() {
  let total = constantDoubles[0] + constantDoubles[1] + constantDoubles[2];
  const child = Object.create(constantDoubles);
  total += (constantDoubles[0] + constantDoubles[1] + constantDoubles[2]) * 100 + child[2];
  return total;
}
report("a constant, Object.create", constantThroughCreate(), constantThroughCreate());

const constantObjects = Object.freeze([{ v: 1 }, { v: 2 }]);
function constantThroughLiteral() {
  let total = constantObjects[0].v + constantObjects[1].v;
  const child = { __proto__: constantObjects };
  total += (constantObjects[0].v + constantObjects[1].v) * 100 + child[1].v;
  return total;
}
report("a constant, a literal", constantThroughLiteral(), constantThroughLiteral());

function local(i) {
  const array = Object.freeze([i, i + 1, i + 2]);
  let total = array[0] + array[1] + array[2];
  const child = Object.create(array);
  total += array[0] + array[1] + array[2] + child[0];
  return total;
}
let locals = 0;
for (let i = 0; i < 20000; i++) locals += local(i & 15);
report("a fresh array each time", locals);

function inLoop(array, turnOfChange) {
  let total = 0;
  let child = null;
  for (let turn = 0; turn < 50; turn++) {
    for (let i = 0; i < array.length; i++) total += array[i];
    if (turn === turnOfChange) child = Object.create(array);
  }
  return total + child[0];
}
report("in the middle of a loop", inLoop(Object.freeze([1, 2, 3, 4]), 25), inLoop(Object.freeze([0.25, 0.5]), 10), inLoop(Object.freeze([7]), 49));

function storesAreStillRefused(array) {
  const child = Object.create(array);
  let refusals = 0;
  for (const attempt of [() => { array[0] = 9; }, () => { array.push(9); }, () => { array.length = 0; }, () => { child[0] = 9; }, () => { delete array[0]; }]) {
    try { attempt(); } catch (error) { refusals++; }
  }
  child[7] = "own";
  return [refusals, array[0], array.length, child[0], Object.keys(child)];
}
report("stores", storesAreStillRefused(Object.freeze([5, 6])));

console.log(lines.join("\n"));
