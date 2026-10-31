// slice, with, toReversed and toSpliced make a list of doubles where what reads the copy expects doubles. Nothing of that shows.
const show = list => {
  const shown = [];
  for (let i = 0; i < list.length; i++) shown.push(i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole");
  return list.length + ": " + shown.join(" ");
};
const attempt = (name, make) => {
  try {
    console.log(name, show(make()));
  } catch (error) {
    console.log(name, error.name, error.message);
  }
};
const half = n => n / 2;
const whole = [1, 2, 3, 4, 5, 6, 7, 8];
const withHole = [1, 2, , 4, 5];
const fractions = [1.5, 2.5, 3.5];
const mixed = [1, "two", { three: 3 }, null, undefined];

function sliceAndStore(list, value, ...range) {
  const copy = list.slice(...range);
  copy[1] = value;
  return copy;
}
function sliceAll(list, value) {
  const copy = list.slice();
  copy[2] = value;
  return copy;
}
function slicePart(list, from, to, value) {
  const copy = list.slice(from, to);
  copy[0] = value;
  return copy;
}
function reverseAndStore(list, value) {
  const copy = list.toReversed();
  copy[0] = value;
  return copy;
}
function replace(list, at, value) {
  return list.with(at, value);
}
function spliced(list, from, count, value) {
  return list.toSpliced(from, count, value);
}
function splicedTwo(list, from, count, a, b) {
  return list.toSpliced(from, count, a, b);
}

for (const value of [half(3), half(4), -0, NaN, Infinity, 2 ** 31, -(2 ** 31), 2 ** 53, 7]) {
  attempt("slice all", () => sliceAll(whole, value));
  attempt("slice part", () => slicePart(whole, 1, 4, value));
  attempt("slice past the end", () => slicePart(whole, 6, 100, value));
  attempt("slice from the end", () => slicePart(whole, -3, -1, value));
  attempt("slice empty", () => slicePart(whole, 5, 2, value));
  attempt("slice a hole", () => sliceAll(withHole, value));
  attempt("slice fractions", () => sliceAll(fractions, value));
  attempt("slice mixed", () => sliceAll(mixed, value));
  attempt("reverse", () => reverseAndStore(whole, value));
  attempt("reverse a hole", () => reverseAndStore(withHole, value));
  attempt("reverse fractions", () => reverseAndStore(fractions, value));
  attempt("reverse mixed", () => reverseAndStore(mixed, value));
  attempt("reverse nothing", () => reverseAndStore([], value));
  attempt("with", () => replace(whole, 2, value));
  attempt("with from the end", () => replace(whole, -1, value));
  attempt("with a hole", () => replace(withHole, 0, value));
  attempt("with fractions", () => replace(fractions, 1, value));
  attempt("with mixed", () => replace(mixed, 1, value));
  attempt("spliced", () => spliced(whole, 2, 1, value));
  attempt("spliced grows", () => spliced(whole, 2, 0, value));
  attempt("spliced shrinks", () => spliced(whole, 1, 4, value));
  attempt("spliced from the end", () => spliced(whole, -2, 1, value));
  attempt("spliced far past the end", () => spliced(whole, 100, 100, value));
  attempt("spliced far before the start", () => spliced(whole, -100, -5, value));
  attempt("spliced a hole", () => spliced(withHole, 0, 1, value));
  attempt("spliced two", () => splicedTwo(whole, 3, 2, value, value));
  attempt("slice with two arguments and a store", () => sliceAndStore(whole, value, 1, 5));
}

for (const value of ["text", null, undefined, { an: "object" }, 5n, true]) {
  attempt("with something else", () => replace(whole, 2, value));
  attempt("spliced something else", () => spliced(whole, 2, 1, value));
  attempt("slice something else", () => sliceAll(whole, value));
  attempt("reverse something else", () => reverseAndStore(whole, value));
}

for (const at of [8, -9, 100, -100, 1.5, -0, NaN, 2 ** 40, Infinity])
  attempt("with at " + at, () => replace(whole, at, 0.5));
for (const [from, count] of [[1.5, 1.5], [NaN, NaN], [-0, -0], [Infinity, 1], [-Infinity, Infinity], [2, -1], [2 ** 40, 2 ** 40]])
  attempt("spliced at " + from + " " + count, () => spliced(whole, from, count, 0.5));

attempt("toSpliced without arguments", () => whole.toSpliced());
attempt("toSpliced with a start alone", () => whole.toSpliced(3));
attempt("toSpliced with undefined", () => whole.toSpliced(undefined));
attempt("toSpliced with undefined twice", () => whole.toSpliced(undefined, undefined));
attempt("toSpliced with a text", () => whole.toSpliced("2", "1", 0.5));

// A hole reads what the prototype holds, for all of these but slice.
Object.setPrototypeOf(withHole, { 2: "from another prototype", __proto__: Array.prototype });
attempt("with over a prototype", () => replace(withHole, 0, 0.5));
attempt("reverse over a prototype", () => reverseAndStore(withHole, 0.5));
attempt("spliced over a prototype", () => spliced(withHole, 0, 1, 0.5));
attempt("slice over a prototype", () => sliceAll(withHole, 0.5));
Object.setPrototypeOf(withHole, Array.prototype);

class Listed extends Array {}
const subclass = Listed.from([1, 2, 3]);
for (const [name, copy] of [["slice", sliceAll(subclass, 0.5)], ["reverse", reverseAndStore(subclass, 0.5)], ["with", replace(subclass, 0, 0.5)], ["spliced", spliced(subclass, 0, 1, 0.5)]])
  console.log(name, copy.constructor.name, copy instanceof Listed, show(copy));

const frozen = Object.freeze([1, 2, 3]);
attempt("slice a frozen list", () => sliceAll(frozen, 0.5));
attempt("reverse a frozen list", () => reverseAndStore(frozen, 0.5));
attempt("with of a frozen list", () => replace(frozen, 0, 0.5));
attempt("spliced of a frozen list", () => spliced(frozen, 0, 1, 0.5));

const named = [1, 2, 3];
named.extra = "name";
const copyOfNamed = sliceAll(named, 0.5);
console.log("names", Object.keys(copyOfNamed).join(), Object.isFrozen(replace(frozen, 0, 0.5)));

// What is done to a copy afterwards.
for (const copy of [sliceAll(whole, 0.5), replace(whole, 1, 0.5), reverseAndStore(whole, 0.5), spliced(whole, 1, 1, 0.5)]) {
  console.log(copy.indexOf(0.5), copy.includes(NaN), copy.includes(3), copy.join(), JSON.stringify(copy));
  copy.push("text");
  copy.length = 3;
  console.log(show(copy), show(copy.concat([1, 2])), show(copy.slice().sort()));
}
const source = [1, 2, 3, 4];
const independent = sliceAll(source, 0.5);
source[0] = 100;
independent[1] = 200;
console.log(show(source), show(independent));

let total = 0;
for (let i = 0; i < 20000; i++) {
  const copy = whole.slice();
  copy[i & 7] = i * 3;
  const other = whole.with(i & 7, i * 0.5);
  const third = whole.toSpliced(i & 3, i & 1, i * 3);
  const fourth = whole.toReversed();
  fourth[i & 7] = i * 0.25;
  total += copy[i & 3] + other[(i + 1) & 7] + third[i & 3] + fourth[(i + 2) & 7];
}
console.log(total);
