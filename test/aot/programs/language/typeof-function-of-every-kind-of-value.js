// `typeof x === "function"` gives what plain Bun gives for every kind of value, in code that runs once, in a rare branch and in a hot loop: closures, methods, classes, bound, async and generator functions, native functions and constructors, proxies of functions and of objects, and everything that is no function
class Plain {
  method() {}
  static make() {}
  get value() {
    return 1;
  }
}
class Derived extends Plain {}
function declared() {}
function withProperties() {}
withProperties.extra = 1;
const arrow = () => 1;
const capturing = (n => () => n)(3);
async function asynchronous() {}
function* generator() {}
async function* asyncGenerator() {}

const values = [
  ["declared", declared],
  ["with properties", withProperties],
  ["arrow", arrow],
  ["capturing", capturing],
  ["async", asynchronous],
  ["generator", generator],
  ["async generator", asyncGenerator],
  ["class", Plain],
  ["derived class", Derived],
  ["method", Plain.prototype.method],
  ["static method", Plain.make],
  ["getter", Object.getOwnPropertyDescriptor(Plain.prototype, "value").get],
  ["bound", declared.bind(null)],
  ["bound native", Math.max.bind(null, 1)],
  ["native", Math.max],
  ["native constructor", Map],
  ["Function.prototype", Function.prototype],
  ["Proxy", Proxy],
  ["proxy of a function", new Proxy(declared, {})],
  ["proxy of a class", new Proxy(Plain, {})],
  ["proxy of a proxy of a function", new Proxy(new Proxy(arrow, {}), {})],
  ["revocable proxy of a function", Proxy.revocable(declared, {}).proxy],
  ["proxy of an object", new Proxy({}, {})],
  ["proxy of an array", new Proxy([], {})],
  ["object", {}],
  ["object with call", { call() {}, apply() {} }],
  ["object without prototype", Object.create(null)],
  ["heir of a function", Object.create(declared)],
  ["instance", new Plain()],
  ["array", []],
  ["regexp", /x/],
  ["date", new Date(0)],
  ["map", new Map()],
  ["promise", Promise.resolve()],
  ["typed array", new Uint8Array(1)],
  ["error", new Error("x")],
  ["generator object", generator()],
  ["boxed string", new String("function")],
  ["string", "function"],
  ["empty string", ""],
  ["symbol", Symbol("function")],
  ["bigint", 10n],
  ["large bigint", 2n ** 70n],
  ["int", 1],
  ["zero", 0],
  ["double", 1.5],
  ["NaN", NaN],
  ["true", true],
  ["false", false],
  ["null", null],
  ["undefined", undefined],
];

for (const [name, value] of values) console.log("once:", name, typeof value === "function");

function orUndefined(value) {
  return value === undefined || typeof value === "function";
}
for (const [name, value] of values) console.log("or undefined:", name, orUndefined(value));

function inRareBranch(value, isRare) {
  if (isRare) {
    if (typeof value === "function") return "function";
    return "other";
  }
  return "usual";
}
let usual = 0;
for (let i = 0; i < 20000; i++) if (inRareBranch(values[i % values.length][1], false) === "usual") usual++;
console.log("usual:", usual);
for (const [name, value] of values) console.log("rare:", name, inRareBranch(value, true));

function count(list) {
  let functions = 0;
  for (let i = 0; i < list.length; i++) if (typeof list[i][1] === "function") functions++;
  return functions;
}
let total = 0;
for (let i = 0; i < 5000; i++) total += count(values);
console.log("hot:", total);

function callIfCallable(value) {
  try {
    return typeof value === "function" ? typeof value.name : "not called";
  } catch (error) {
    return error.constructor.name;
  }
}
for (const [name, value] of values) console.log("name:", name, callIfCallable(value));
