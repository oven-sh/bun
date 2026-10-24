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

const util = require("node:util");
const { AsyncLocalStorage, AsyncResource } = require("node:async_hooks");
const { EventEmitter } = require("node:events");

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
for (const [name, make] of notLists) attempt("util.promisify, total of " + name, () => typeof util.promisify(totalOne)(make()).catch(() => {}));
for (const [name, make] of notNumbers) attempt("util.promisify, half of " + name, () => typeof util.promisify(halfOne)(make()).catch(() => {}));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("util.deprecate, total of " + name, () => util.deprecate(totalTwo, "old", "DEP" + "X")(make()));
for (const [name, make] of notNumbers) attempt("util.deprecate, half of " + name, () => util.deprecate(halfTwo, "old", "DEP" + "X")(make()));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("AsyncLocalStorage.run, total of " + name, () => new AsyncLocalStorage().run({}, totalThree, make()));
for (const [name, make] of notNumbers) attempt("AsyncLocalStorage.run, half of " + name, () => new AsyncLocalStorage().run({}, halfThree, make()));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("AsyncLocalStorage.exit, total of " + name, () => new AsyncLocalStorage().exit(totalFour, make()));
for (const [name, make] of notNumbers) attempt("AsyncLocalStorage.exit, half of " + name, () => new AsyncLocalStorage().exit(halfFour, make()));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("AsyncLocalStorage.bind, total of " + name, () => AsyncLocalStorage.bind(totalFive)(make()));
for (const [name, make] of notNumbers) attempt("AsyncLocalStorage.bind, half of " + name, () => AsyncLocalStorage.bind(halfFive)(make()));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("AsyncResource.bind, total of " + name, () => AsyncResource.bind(totalSix)(make()));
for (const [name, make] of notNumbers) attempt("AsyncResource.bind, half of " + name, () => AsyncResource.bind(halfSix)(make()));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("runInAsyncScope, total of " + name, () => new AsyncResource("test").runInAsyncScope(totalSeven, null, make()));
for (const [name, make] of notNumbers) attempt("runInAsyncScope, half of " + name, () => new AsyncResource("test").runInAsyncScope(halfSeven, null, make()));
console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("once, total of " + name, () => new EventEmitter().once("go", totalEight).emit("go", make()));
for (const [name, make] of notNumbers) attempt("once, half of " + name, () => new EventEmitter().once("go", halfEight).emit("go", make()));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("prependListener, total of " + name, () => new EventEmitter().prependListener("go", totalNine).emit("go", make()));
for (const [name, make] of notNumbers) attempt("prependListener, half of " + name, () => new EventEmitter().prependListener("go", halfNine).emit("go", make()));
console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("the raw listeners that an emitter lists, total of " + name, () => new EventEmitter().on("go", totalTen).rawListeners("go")[0](make()));
for (const [name, make] of notNumbers) attempt("the raw listeners that an emitter lists, half of " + name, () => new EventEmitter().on("go", halfTen).rawListeners("go")[0](make()));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("the listeners that an emitter lists, total of " + name, () => new EventEmitter().on("go", totalEleven).listeners("go")[0](make()));
for (const [name, make] of notNumbers) attempt("the listeners that an emitter lists, half of " + name, () => new EventEmitter().on("go", halfEleven).listeners("go")[0](make()));
console.log("honest", totalEleven([1, 2, 3]), totalEleven([]), totalEleven(new Array(4, 5)), totalEleven([0.5]), halfEleven(4), halfEleven(3), halfEleven(0.5), halfEleven(-8));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
for (const [name, make] of notLists) attempt("util.inherits keeps the constructor under super_, total of " + name, () => { function Child() {} util.inherits(Child, totalTwelve); return Child.super_(make()); });
for (const [name, make] of notNumbers) attempt("util.inherits keeps the constructor under super_, half of " + name, () => { function Child() {} util.inherits(Child, halfTwelve); return Child.super_(make()); });
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
