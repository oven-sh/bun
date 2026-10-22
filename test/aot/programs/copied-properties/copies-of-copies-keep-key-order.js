// A literal that copies an object gets its keys in the order of creation: its own members up to the copy, what the source has, then the members behind the copy.
// A copy of such a literal sees that order, whatever the compiler expected.
const lines = [];
const show = object =>
  Reflect.ownKeys(object)
    .map(key => String(key) + "=" + String(object[key]))
    .join(",");

const tag = Symbol("tag");

function replaceFirst(state, value) {
  return { ...state, a: value };
}

function addBehind(state, value) {
  return { ...state, z: value };
}

function addInFront(state, value) {
  return { z: value, ...state };
}

function between(state, other) {
  return { p: 1, ...state, q: 2, ...other, r: 3 };
}

function withoutFirst({ a, ...rest }) {
  return rest;
}

function maybe(condition, state) {
  return { first: 1, ...(condition && state), last: 2 };
}

function computed(state, key) {
  return { ...state, [key]: 1, z: 2 };
}

function withGetter(state) {
  return {
    ...state,
    get twice() {
      return this.a * 2;
    },
    z: 2,
  };
}

function reduce(turns) {
  let state = { a: 0, b: 1, c: 2 };
  for (let i = 0; i < turns; i++) state = replaceFirst(state, i);
  return state;
}

function chain(turns) {
  let total = 0;
  let last;
  for (let i = 0; i < turns; i++) {
    const inner = addBehind({ a: i, b: 1 }, i);
    const outer = addInFront(replaceFirst(inner, i + 1), i);
    last = between(outer, withoutFirst(inner));
    total += last.a + last.z + last.r;
  }
  return show(last) + " " + total;
}

lines.push(show(reduce(2000)));
lines.push(chain(2000));

// The same functions meet objects with another order, with more keys and with none.
const otherOrders = [
  { c: 1, b: 2, a: 3 },
  { b: 1 },
  {},
  { a: 1, [tag]: 2, b: 3 },
  { 2: "two", a: 1, 1: "one" },
  Object.assign({ a: 1 }, JSON.parse('{"late":1,"later":2}')),
  Object.defineProperty({ a: 1, b: 2 }, "hidden", { value: 3, enumerable: false }),
  Object.freeze({ b: 1, a: 2 }),
  Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }),
  [7, 8],
  "xy",
  5,
  null,
  undefined,
];
for (const source of otherOrders) {
  lines.push(show(replaceFirst(source, 9)));
  lines.push(show(addBehind(source, 9)));
  lines.push(show(addInFront(source, 9)));
  lines.push(show(between(source, source)));
  lines.push(show(replaceFirst(replaceFirst(source, 8), 9)));
  lines.push(show(addBehind(addInFront(source, 8), 9)));
  if (source != null) lines.push(show(withoutFirst(source)));
}

// A key that is deleted and created once more moves to the end, in the source and in every copy of it.
const moved = replaceFirst({ a: 1, b: 2, c: 3 }, 4);
delete moved.a;
moved.a = 5;
lines.push(show(moved), show(replaceFirst(moved, 6)), show(addBehind(moved, 6)));

for (let i = 0; i < 300; i++) {
  const state = { a: i, b: i };
  const taken = maybe(i % 3 === 0, state);
  if (i > 296) lines.push(show(taken), show(replaceFirst(taken, 0)));
}

for (const key of ["k", "a", "z", "0", tag]) {
  const made = computed({ a: 1, b: 2 }, key);
  lines.push(show(made), show(addBehind(made, 3)));
}

const accessor = withGetter({ a: 21, b: 2 });
lines.push(show(accessor), show(replaceFirst(accessor, 1)), typeof Object.getOwnPropertyDescriptor(replaceFirst(accessor, 1), "twice").get);

// A getter of the source runs in the middle of the copy and sees what the literal has so far through nothing but its own effects.
let runs = 0;
const counting = {
  a: 1,
  get b() {
    return ++runs;
  },
  c: 3,
};
lines.push(show(replaceFirst(counting, 0)), show(replaceFirst(replaceFirst(counting, 0), 1)), String(runs));

console.log(lines.join("\n"));
