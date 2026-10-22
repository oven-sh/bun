console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function makeAList() {
  leakedList = [1, 2, 3];
  return leakedList.length;
}
function makeANumber() {
  leakedNumber = 1;
  return leakedNumber + 1;
}
function bump() {
  leakedNumber++;
  return leakedNumber;
}
function addToAbsent() {
  neverMade += 1;
  return neverMade;
}
function fillIn() {
  leakedLater ??= "filled in";
  return leakedLater;
}
function chained() {
  var local = (leakedByAChain = 5);
  return [local, typeof leakedByAChain];
}
function fromAPattern() {
  [leakedA, leakedB] = [1, 2];
  return leakedA + leakedB;
}
function loopVariable() {
  for (leakedIndex = 0; leakedIndex < 3; leakedIndex++);
  return leakedIndex;
}
function forIn() {
  for (leakedKey in { a: 1 });
  return leakedKey;
}
function size() {
  return leakedList.length;
}
function next() {
  return leakedNumber + 1;
}
function kinds() {
  return [typeof leakedList, typeof leakedNumber, typeof leakedLater, typeof leakedByAChain, typeof leakedA, typeof leakedIndex, typeof leakedKey];
}

attempt("kinds at first", kinds);
var uses = { makeAList, makeANumber, bump, addToAbsent, fillIn, chained, fromAPattern, loopVariable, forIn, size, next };
for (var name in uses) attempt(name, uses[name]);
attempt("kinds afterwards", kinds);
attempt("on the global object", () => Object.keys(globalThis).filter(key => key.startsWith("leaked")).sort());
attempt("how it is defined", () => Object.getOwnPropertyDescriptor(globalThis, "leakedNumber"));
globalThis.leakedList = [1];
globalThis.leakedNumber = 1;
var sum = 0;
for (var i = 0; i < 2000; i++) sum += size() + next();
console.log("sum", sum);
globalThis.leakedList = "a text";
globalThis.leakedNumber = "a text";
attempt("after texts were stored", () => [size(), next(), bump()]);
Object.defineProperty(globalThis, "leakedNumber", { get: () => 41, configurable: true });
attempt("after a getter was defined", () => [next(), makeANumber()]);
Object.defineProperty(globalThis, "leakedList", { value: Object.freeze([]), writable: false, configurable: true });
attempt("after the member was fixed", () => makeAList());
for (var key of Object.keys(globalThis).concat(["leakedNumber", "leakedList"])) if (key.startsWith("leaked")) delete globalThis[key];
attempt("after they were removed", () => [size(), next()]);
attempt("kinds at last", kinds);
