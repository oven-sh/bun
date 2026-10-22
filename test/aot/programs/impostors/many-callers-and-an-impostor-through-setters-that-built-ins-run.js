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
for (const [name, make] of notLists) attempt("Object.assign, total of " + name, () => typeof Object.assign(Object.defineProperty({}, "value", { set: totalOne }), { value: make() }));
for (const [name, make] of notNumbers) attempt("Object.assign, half of " + name, () => typeof Object.assign(Object.defineProperty({}, "value", { set: halfOne }), { value: make() }));
console.log("honest", totalOne([1, 2, 3]), totalOne([]), totalOne(new Array(4, 5)), totalOne([0.5]), halfOne(4), halfOne(3), halfOne(0.5), halfOne(-8));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("Reflect.set, total of " + name, () => Reflect.set(Object.defineProperty({}, "value", { set: totalTwo }), "value", make()));
for (const [name, make] of notNumbers) attempt("Reflect.set, half of " + name, () => Reflect.set(Object.defineProperty({}, "value", { set: halfTwo }), "value", make()));
console.log("honest", totalTwo([1, 2, 3]), totalTwo([]), totalTwo(new Array(4, 5)), totalTwo([0.5]), halfTwo(4), halfTwo(3), halfTwo(0.5), halfTwo(-8));
for (const [name, make] of notLists) attempt("Reflect.set through an heir, total of " + name, () => Reflect.set(Object.create(Object.defineProperty({}, "value", { set: totalThree })), "value", make()));
for (const [name, make] of notNumbers) attempt("Reflect.set through an heir, half of " + name, () => Reflect.set(Object.create(Object.defineProperty({}, "value", { set: halfThree })), "value", make()));
console.log("honest", totalThree([1, 2, 3]), totalThree([]), totalThree(new Array(4, 5)), totalThree([0.5]), halfThree(4), halfThree(3), halfThree(0.5), halfThree(-8));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("a store to an heir, total of " + name, () => typeof (Object.create(Object.defineProperty({}, "value", { set: totalFour })).value = make()));
for (const [name, make] of notNumbers) attempt("a store to an heir, half of " + name, () => typeof (Object.create(Object.defineProperty({}, "value", { set: halfFour })).value = make()));
console.log("honest", totalFour([1, 2, 3]), totalFour([]), totalFour(new Array(4, 5)), totalFour([0.5]), halfFour(4), halfFour(3), halfFour(0.5), halfFour(-8));
for (const [name, make] of notLists) attempt("a store under a computed name, total of " + name, () => typeof (Object.defineProperty({}, "value", { set: totalFive })[["val", "ue"].join("")] = make()));
for (const [name, make] of notNumbers) attempt("a store under a computed name, half of " + name, () => typeof (Object.defineProperty({}, "value", { set: halfFive })[["val", "ue"].join("")] = make()));
console.log("honest", totalFive([1, 2, 3]), totalFive([]), totalFive(new Array(4, 5)), totalFive([0.5]), halfFive(4), halfFive(3), halfFive(0.5), halfFive(-8));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("Object.defineProperties, total of " + name, () => typeof (Object.defineProperties({}, { value: { set: totalSix } }).value = make()));
for (const [name, make] of notNumbers) attempt("Object.defineProperties, half of " + name, () => typeof (Object.defineProperties({}, { value: { set: halfSix } }).value = make()));
console.log("honest", totalSix([1, 2, 3]), totalSix([]), totalSix(new Array(4, 5)), totalSix([0.5]), halfSix(4), halfSix(3), halfSix(0.5), halfSix(-8));
for (const [name, make] of notLists) attempt("__defineSetter__, total of " + name, () => { const object = {}; object.__defineSetter__("value", totalSeven); object.value = make(); });
for (const [name, make] of notNumbers) attempt("__defineSetter__, half of " + name, () => { const object = {}; object.__defineSetter__("value", halfSeven); object.value = make(); });
console.log("honest", totalSeven([1, 2, 3]), totalSeven([]), totalSeven(new Array(4, 5)), totalSeven([0.5]), halfSeven(4), halfSeven(3), halfSeven(0.5), halfSeven(-8));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
for (const [name, make] of notLists) attempt("a setter for an index of an array-like that push stores to, total of " + name, () => Array.prototype.push.call(Object.defineProperty({ length: 0 }, "0", { set: totalEight }), make()));
for (const [name, make] of notNumbers) attempt("a setter for an index of an array-like that push stores to, half of " + name, () => Array.prototype.push.call(Object.defineProperty({ length: 0 }, "0", { set: halfEight }), make()));
console.log("honest", totalEight([1, 2, 3]), totalEight([]), totalEight(new Array(4, 5)), totalEight([0.5]), halfEight(4), halfEight(3), halfEight(0.5), halfEight(-8));
attempt("a setter for length that push stores to, total", () => Array.prototype.push.call(Object.defineProperty({}, "length", { get: () => 0, set: totalNine }), 1));
attempt("a setter for length that push stores to, half", () => Array.prototype.push.call(Object.defineProperty({}, "length", { get: () => 0, set: halfNine }), 1));
console.log("honest", totalNine([1, 2, 3]), totalNine([]), totalNine(new Array(4, 5)), totalNine([0.5]), halfNine(4), halfNine(3), halfNine(0.5), halfNine(-8));
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("a destructuring assignment, total of " + name, () => { [Object.defineProperty({}, "value", { set: totalTen }).value] = [make()]; });
for (const [name, make] of notNumbers) attempt("a destructuring assignment, half of " + name, () => { [Object.defineProperty({}, "value", { set: halfTen }).value] = [make()]; });
console.log("honest", totalTen([1, 2, 3]), totalTen([]), totalTen(new Array(4, 5)), totalTen([0.5]), halfTen(4), halfTen(3), halfTen(0.5), halfTen(-8));
for (const [name, make] of notLists) attempt("a for-of loop that stores to it, total of " + name, () => { const object = Object.defineProperty({}, "value", { set: totalEleven }); for (object.value of [make()]); });
for (const [name, make] of notNumbers) attempt("a for-of loop that stores to it, half of " + name, () => { const object = Object.defineProperty({}, "value", { set: halfEleven }); for (object.value of [make()]); });
console.log("honest", totalEleven([1, 2, 3]), totalEleven([]), totalEleven(new Array(4, 5)), totalEleven([0.5]), halfEleven(4), halfEleven(3), halfEleven(0.5), halfEleven(-8));
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
for (const [name, make] of notLists) attempt("the set trap of a proxy, total of " + name, () => { new Proxy({}, { set: (target, key, value) => (totalTwelve(value), true) }).value = make(); });
for (const [name, make] of notNumbers) attempt("the set trap of a proxy, half of " + name, () => { new Proxy({}, { set: (target, key, value) => (halfTwelve(value), true) }).value = make(); });
console.log("honest", totalTwelve([1, 2, 3]), totalTwelve([]), totalTwelve(new Array(4, 5)), totalTwelve([0.5]), halfTwelve(4), halfTwelve(3), halfTwelve(0.5), halfTwelve(-8));
