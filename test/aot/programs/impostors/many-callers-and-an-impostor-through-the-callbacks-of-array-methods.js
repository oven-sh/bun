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

console.log("strict:", (function () { return this === undefined; })());
for (const [name, make] of notLists) attempt("every, total of " + name, () => [make()].every(totalOne));
for (const [name, make] of notNumbers) attempt("every, half of " + name, () => [make()].every(halfOne));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("some, total of " + name, () => [make()].some(totalTwo));
for (const [name, make] of notNumbers) attempt("some, half of " + name, () => [make()].some(halfTwo));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("find, total of " + name, () => typeof [make()].find(totalThree));
for (const [name, make] of notNumbers) attempt("find, half of " + name, () => typeof [make()].find(halfThree));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("findIndex, total of " + name, () => [make()].findIndex(totalFour));
for (const [name, make] of notNumbers) attempt("findIndex, half of " + name, () => [make()].findIndex(halfFour));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("findLast, total of " + name, () => typeof [make()].findLast(totalFive));
for (const [name, make] of notNumbers) attempt("findLast, half of " + name, () => typeof [make()].findLast(halfFive));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("findLastIndex, total of " + name, () => [make()].findLastIndex(totalSix));
for (const [name, make] of notNumbers) attempt("findLastIndex, half of " + name, () => [make()].findLastIndex(halfSix));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("flatMap, total of " + name, () => [make()].flatMap(totalSeven));
for (const [name, make] of notNumbers) attempt("flatMap, half of " + name, () => [make()].flatMap(halfSeven));
console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("reduceRight, total of " + name, () => [0, make()].reduceRight(totalEight));
for (const [name, make] of notNumbers) attempt("reduceRight, half of " + name, () => [0, make()].reduceRight(halfEight));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("reduce with a start, total of " + name, () => [0].reduce(totalNine, make()));
for (const [name, make] of notNumbers) attempt("reduce with a start, half of " + name, () => [0].reduce(halfNine, make()));
console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("toSorted, total of " + name, () => [make(), make()].toSorted(totalTen).length);
for (const [name, make] of notNumbers) attempt("toSorted, half of " + name, () => [make(), make()].toSorted(halfTen).length);
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("sort borrowed for an array-like, total of " + name, () => Array.prototype.sort.call({ length: 2, 0: make(), 1: make() }, totalEleven).length);
for (const [name, make] of notNumbers) attempt("sort borrowed for an array-like, half of " + name, () => Array.prototype.sort.call({ length: 2, 0: make(), 1: make() }, halfEleven).length);
console.log("honest", totalEleven([1, 2, 3]), totalEleven([]), totalEleven(new Array(4, 5)), totalEleven([0.5]), halfEleven(4), halfEleven(3), halfEleven(0.5), halfEleven(-8));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
for (const [name, make] of notLists) attempt("Array.from over a Set, total of " + name, () => Array.from(new Set([make()]), totalTwelve));
for (const [name, make] of notNumbers) attempt("Array.from over a Set, half of " + name, () => Array.from(new Set([make()]), halfTwelve));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
