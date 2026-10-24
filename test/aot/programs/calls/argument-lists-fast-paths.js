// Calls whose arguments are a list in memory: spread, apply, more arguments than registers, and their tail-call form.
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100, 4096, 4097];

function makeInts(length) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(i);
  return list;
}

function makeDoubles(length) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(i + 0.5);
  return list;
}

function makeMixed(length) {
  const list = [];
  for (let i = 0; i < length; i++) list.push(i % 3 === 0 ? i : i % 3 === 1 ? i + 0.25 : "s" + i);
  return list;
}

function describeList(list) {
  let total = 0;
  let strings = 0;
  for (let i = 0; i < list.length; i++) {
    if (typeof list[i] === "number") total += list[i];
    else if (list[i] === undefined) total -= 1;
    else strings += 1;
  }
  return list.length + "/" + total + "/" + strings;
}

function takesRest(...rest) {
  return describeList(rest);
}

function takesArguments() {
  return describeList(arguments);
}

function takesFixed(a, b, c, d, e, f, g, h, i, j) {
  return describeList([a, b, c, d, e, f, g, h, i, j]) + "/" + arguments.length;
}

function takesTwo(a, b) {
  return describeList([a, b]) + "/" + arguments.length;
}

function readsThis() {
  "use strict";
  return String(this) + ":" + arguments.length;
}

class Constructed {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    this.text = describeList([a, b, c, d, e, f, g, h, i, j]) + "/" + arguments.length;
  }
}

const callees = [takesRest, takesArguments, takesFixed, takesTwo, takesRest.bind(null, 1), takesFixed.bind(null, 1, 2)];

for (const make of [makeInts, makeDoubles, makeMixed]) {
  for (const length of lengths) {
    const list = make(length);
    const answers = [];
    for (const callee of callees) {
      answers.push(callee(...list));
      answers.push(callee.apply(null, list));
    }
    console.log(make.name, length, answers.join(" "));
  }
}

for (const length of lengths) {
  const ints = makeInts(length);
  const doubles = makeDoubles(length);
  console.log("host", length, Math.max(...ints), Math.max.apply(null, doubles), readsThis.apply("t", ints), readsThis.call("t", ...doubles));
}

const copyOnWriteInts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const copyOnWriteDoubles = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];
const copyOnWriteShort = [1, 2];
const copyOnWriteMixed = [1, "two", 3.5, null, true, 6, 7, 8, 9, 10];
for (const list of [copyOnWriteInts, copyOnWriteDoubles, copyOnWriteShort, copyOnWriteMixed]) {
  console.log("literal", takesRest(...list), takesFixed.apply(null, list), new Constructed(...list).text);
}

function forwardSloppy() {
  return takesRest.apply(this, arguments);
}

function forwardStrict() {
  "use strict";
  return readsThis.apply(this, arguments) + " " + takesRest.apply(this, arguments);
}

for (const list of [[], [1], [1, 2.5], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
  console.log("forward", forwardSloppy(...list), forwardStrict.apply("t", list));
}

function evenFixed(n, a, b, c, d, e, f, g, h, i) {
  "use strict";
  if (n === 0) return "even " + (a + b + c + d + e + f + g + h + i);
  return oddFixed(n - 1, a, b, c, d, e, f, g, h, i);
}

function oddFixed(n, a, b, c, d, e, f, g, h, i) {
  "use strict";
  if (n === 0) return "odd " + (a + b + c + d + e + f + g + h + i);
  return evenFixed(n - 1, a, b, c, d, e, f, g, h, i);
}

function evenSpread(n, a, b, c, d, e, f, g, h, i) {
  "use strict";
  if (n === 0) return "even " + (a + b + c + d + e + f + g + h + i);
  return oddSpread(...[n - 1, a, b, c, d, e, f, g, h, i]);
}

function oddSpread(n, a, b, c, d, e, f, g, h, i) {
  "use strict";
  if (n === 0) return "odd " + (a + b + c + d + e + f + g + h + i);
  return evenSpread(...[n - 1, a, b, c, d, e, f, g, h, i]);
}

console.log(evenFixed(200000, 1, 2, 3, 4, 5, 6, 7, 8, 9));
console.log(evenFixed(200001, 1, 2, 3, 4, 5, 6, 7, 8, 9));
console.log(evenSpread(200000, 1, 2, 3, 4, 5, 6, 7, 8, 9));
console.log(oddSpread(200001, 1, 2, 3, 4, 5, 6, 7, 8, 9));

function attempt(name, action) {
  try {
    console.log(name, action());
  } catch (error) {
    console.log(name, "threw", error.name);
  }
}

function makeEmptyWithLength() {
  const list = [];
  list.length = 3;
  return list;
}

class ArraySubclass extends Array {}

function makeSubclass() {
  const list = new ArraySubclass();
  list.push(1, 2, 3);
  return list;
}

function makeOwnIterator() {
  const list = [1, 2, 3];
  list[Symbol.iterator] = function* () {
    yield "replaced";
  };
  return list;
}

function makeArguments() {
  return arguments;
}

function makeArgumentsWithLength() {
  "use strict";
  arguments.length = 1;
  return arguments;
}

function makeArgumentsWithDeletion() {
  "use strict";
  delete arguments[1];
  return arguments;
}

const unusual = {
  hole: () => [1, , 3],
  "long hole": () => [1, 2, , 4, 5, 6, 7, 8, 9, 10],
  "double hole": () => [1.5, , 3.5],
  "long double hole": () => [1.5, 2.5, , 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5],
  "empty with length": makeEmptyWithLength,
  subclass: makeSubclass,
  "own iterator": makeOwnIterator,
  arguments: () => makeArguments(1, 2, 3),
  "arguments with length": () => makeArgumentsWithLength(1, 2, 3),
  "arguments with deletion": () => makeArgumentsWithDeletion(1, 2, 3),
  "array-like": () => ({ length: 2, 0: "a", 1: "b" }),
};

for (const name of Object.keys(unusual)) {
  attempt("spread " + name, () => takesRest(...unusual[name]()));
  attempt("apply " + name, () => takesRest.apply(null, unusual[name]()));
}

attempt("apply undefined", () => takesRest.apply("t", undefined));
attempt("apply null", () => takesRest.apply("t", null));
attempt("apply number", () => takesRest.apply("t", 5));
attempt("spread undefined", () => takesRest(...undefined));
attempt("spread number", () => takesRest(...5));

const notCallable = {};
attempt("spread into object", () => notCallable(...[1, 2, 3]));
attempt("long spread into object", () => notCallable(...copyOnWriteInts));
attempt("apply of undefined", () => Function.prototype.apply.call(undefined, null, [1]));

function recurseFixed(n, a, b, c, d, e, f, g, h, i) {
  return 1 + recurseFixed(n + 1, a, b, c, d, e, f, g, h, i);
}

function recurseSpread(n, a, b, c, d, e, f, g, h, i) {
  return 1 + recurseSpread(...[n + 1, a, b, c, d, e, f, g, h, i]);
}

attempt("recursion with registers and stack", () => recurseFixed(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
attempt("recursion through spread", () => recurseSpread(0, 1, 2, 3, 4, 5, 6, 7, 8, 9));
console.log("after recursion", takesRest(...copyOnWriteInts));
