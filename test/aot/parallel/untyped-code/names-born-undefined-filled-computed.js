// A literal lists names with undefined to make room for them, and the program fills them under keys that it computes.
const names = ["close", "error", "end", "finish", "data", "drain", "unpipe", "readable"];
function room() {
  return { close: undefined, error: undefined, data: undefined, end: undefined, readable: undefined };
}
function describe(label, object) {
  const parts = [];
  for (const key in object) parts.push(key + "=" + (typeof object[key] === "function" ? object[key].name : JSON.stringify(object[key])));
  console.log(label, Object.keys(object).length, parts.join(" "), JSON.stringify(object));
}
function first() {}
function second() {}
const untouched = room();
describe("untouched", untouched);

const filled = room();
for (let i = 0; i < names.length; i++) filled[names[i]] = i & 1 ? first : second;
describe("filled", filled);

const backwards = room();
for (let i = names.length; i--; ) backwards[names[i]] = i;
describe("backwards", backwards);

const some = room();
some[names[1]] = [first, second];
some[names[7]] = "text";
describe("some", some);
delete some[names[1]];
describe("one deleted", some);
some[names[1]] = 1.5;
describe("and back", some);
some[names[0]] = undefined;
some[names[4]] = null;
describe("undefined and null", some);

const frozen = Object.freeze(room());
let refused = 0;
for (const name of names) {
  try {
    (function () {
      "use strict";
      frozen[name] = 1;
    })();
  } catch (error) {
    refused += error instanceof TypeError ? 1 : 100;
  }
}
describe("frozen", frozen);
console.log("refused", refused);

const redefined = room();
Object.defineProperty(redefined, names[2], { get: () => "got", enumerable: false, configurable: true });
redefined[names[0]] = 1;
describe("redefined", redefined);
console.log(redefined.end, Object.getOwnPropertyNames(redefined).join());

const many = [];
for (let i = 0; i < 2000; i++) {
  const object = room();
  object[names[i % 8]] = i;
  object[names[(i * 3 + 1) % 8]] = String(i);
  many.push(object);
}
let sum = 0;
for (const object of many) for (const key of names) sum += typeof object[key] === "number" ? object[key] : object[key] === undefined ? 0 : object[key].length;
console.log("sum", sum, Object.keys(many[3]).join(), Object.keys(many[1999]).join());
console.log("copy", JSON.stringify({ ...many[5] }), JSON.stringify(Object.assign({}, many[6])), JSON.stringify(Object.entries(many[7])));
