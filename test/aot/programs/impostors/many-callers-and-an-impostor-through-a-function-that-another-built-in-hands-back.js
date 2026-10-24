function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1);
}

let last;

function attempt(label, run) {
  last = "never set";
  let line;
  try {
    line = "returned " + show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + ", last " + show(last));
}

const notLists = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 5, length: 1 })],
  ["null", () => null],
];

const notNumbers = [
  ["a numeric string", () => "4"],
  ["a BigInt", () => 4n],
  ["undefined", () => undefined],
];

function totalOne(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfOne(n) {
  return (last = n / 2);
}

function totalTwo(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfTwo(n) {
  return (last = n / 2);
}

function totalThree(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfThree(n) {
  return (last = n / 2);
}

function totalFour(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfFour(n) {
  return (last = n / 2);
}

function totalFive(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfFive(n) {
  return (last = n / 2);
}

function totalSix(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfSix(n) {
  return (last = n / 2);
}

function totalSeven(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfSeven(n) {
  return (last = n / 2);
}

function totalEight(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfEight(n) {
  return (last = n / 2);
}

function totalNine(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfNine(n) {
  return (last = n / 2);
}

function totalTen(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfTen(n) {
  return (last = n / 2);
}

function totalEleven(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfEleven(n) {
  return (last = n / 2);
}

function totalTwelve(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfTwelve(n) {
  return (last = n / 2);
}

function totalThirteen(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfThirteen(n) {
  return (last = n / 2);
}

function totalFourteen(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return (last = sum);
}

function halfFourteen(n) {
  return (last = n / 2);
}

console.log("strict:", (function () { return this === undefined; })());
for (const [name, make] of notLists) attempt("Array.of, total of " + name, () => Array.of(totalOne)[0](make()));
for (const [name, make] of notNumbers) attempt("Array.of, half of " + name, () => Array.of(halfOne)[0](make()));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("Array.from, total of " + name, () => Array.from([totalTwo])[0](make()));
for (const [name, make] of notNumbers) attempt("Array.from, half of " + name, () => Array.from([halfTwo])[0](make()));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("new Array, total of " + name, () => new Array(totalThree)[0](make()));
for (const [name, make] of notNumbers) attempt("new Array, half of " + name, () => new Array(halfThree)[0](make()));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("the iterator of an array, total of " + name, () => [totalFour].values().next().value(make()));
for (const [name, make] of notNumbers) attempt("the iterator of an array, half of " + name, () => [halfFour].values().next().value(make()));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("a spread, total of " + name, () => [...[totalFive]][0](make()));
for (const [name, make] of notNumbers) attempt("a spread, half of " + name, () => [...[halfFive]][0](make()));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("Object.entries, total of " + name, () => Object.entries({ run: totalSix })[0][1](make()));
for (const [name, make] of notNumbers) attempt("Object.entries, half of " + name, () => Object.entries({ run: halfSix })[0][1](make()));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("Object.fromEntries, total of " + name, () => Object.fromEntries([["run", totalSeven]]).run(make()));
for (const [name, make] of notNumbers) attempt("Object.fromEntries, half of " + name, () => Object.fromEntries([["run", halfSeven]]).run(make()));
console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("Object.assign, total of " + name, () => Object.assign({}, { run: totalEight }).run(make()));
for (const [name, make] of notNumbers) attempt("Object.assign, half of " + name, () => Object.assign({}, { run: halfEight }).run(make()));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("Object.create, total of " + name, () => Object.create({ run: totalNine }).run(make()));
for (const [name, make] of notNumbers) attempt("Object.create, half of " + name, () => Object.create({ run: halfNine }).run(make()));
console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("Object.create with descriptors, total of " + name, () => Object.create(null, { run: { value: totalTen } }).run(make()));
for (const [name, make] of notNumbers) attempt("Object.create with descriptors, half of " + name, () => Object.create(null, { run: { value: halfTen } }).run(make()));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("Object.getOwnPropertyDescriptor, total of " + name, () => Object.getOwnPropertyDescriptor({ run: totalEleven }, "run").value(make()));
for (const [name, make] of notNumbers) attempt("Object.getOwnPropertyDescriptor, half of " + name, () => Object.getOwnPropertyDescriptor({ run: halfEleven }, "run").value(make()));
console.log("honest", totalEleven([1, 2, 3]), totalEleven([]), totalEleven(new Array(4, 5)), totalEleven([0.5]), halfEleven(4), halfEleven(3), halfEleven(0.5), halfEleven(-8));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
for (const [name, make] of notLists) attempt("a WeakMap, total of " + name, () => { const key = {}; return new WeakMap([[key, totalTwelve]]).get(key)(make()); });
for (const [name, make] of notNumbers) attempt("a WeakMap, half of " + name, () => { const key = {}; return new WeakMap([[key, halfTwelve]]).get(key)(make()); });
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
for (const [name, make] of notLists) attempt("the keys of a Map, total of " + name, () => [...new Map([[totalThirteen, 1]]).keys()][0](make()));
for (const [name, make] of notNumbers) attempt("the keys of a Map, half of " + name, () => [...new Map([[halfThirteen, 1]]).keys()][0](make()));
console.log("honest", totalThirteen([1, 2, 3]), totalThirteen([]), totalThirteen(new Array(4, 5)), totalThirteen([0.5]), halfThirteen(4), halfThirteen(3), halfThirteen(0.5), halfThirteen(-8));
console.log("honest", totalFourteen([1, 2, 3]), totalFourteen([]), totalFourteen(new Array(4, 5)), totalFourteen([0.5]), halfFourteen(4), halfFourteen(3), halfFourteen(0.5), halfFourteen(-8));
for (const [name, make] of notLists) attempt("Object.groupBy, total of " + name, () => Object.groupBy([totalFourteen], () => "group").group[0](make()));
for (const [name, make] of notNumbers) attempt("Object.groupBy, half of " + name, () => Object.groupBy([halfFourteen], () => "group").group[0](make()));
console.log("honest", totalFourteen([1, 2, 3]), totalFourteen([]), totalFourteen(new Array(4, 5)), totalFourteen([0.5]), halfFourteen(4), halfFourteen(3), halfFourteen(0.5), halfFourteen(-8));
