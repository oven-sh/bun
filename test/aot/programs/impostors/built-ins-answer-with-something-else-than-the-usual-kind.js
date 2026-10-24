"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

function iterates1(text, separator) {
  const a = text.split(separator);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function pushes2(text, separator) {
  const a = text.split(separator);
  a.push(1);
  return a.length;
}
function reads3(text, pattern) {
  const s = text.replace(pattern, "x");
  return s.charCodeAt(0);
}
function adds4(text, pattern) {
  const n = text.search(pattern);
  return [n + 1, n | 0];
}
function iterates5(text, pattern) {
  const seen = [];
  for (const x of text.match(pattern)) seen.push(x);
  return seen;
}
function iterates6(text, pattern) {
  const seen = [];
  for (const x of text.matchAll(pattern)) seen.push(x[0]);
  return seen;
}
for (let i = 0; i < 2000; i++) {
  iterates1("a,b", ",");
  pushes2("a,b", ",");
  reads3("abc", "b");
  adds4("abc", /b/);
  iterates5("abc", /b/);
  iterates6("abc", /b/g);
}
const answering = (symbol, answer) => ({ [symbol]: (...list) => (log.push(String(symbol) + " " + list.length), answer) });
attempt("split", () => iterates1("a,b", ","));
attempt("split answers with a set", () => iterates1("a,b", answering(Symbol.split, new Set([1, 2]))));
attempt("split answers with a text", () => iterates1("a,b", answering(Symbol.split, "xy")));
attempt("split answers with a number", () => iterates1("a,b", answering(Symbol.split, 5)));
attempt("split, then push", () => pushes2("a,b", ","));
attempt("split answers with an array-like, then push", () => pushes2("a,b", answering(Symbol.split, { length: 7, push: () => "pushed" })));
attempt("split answers with a frozen array, then push", () => pushes2("a,b", answering(Symbol.split, Object.freeze(["a"]))));
attempt("split answers with undefined, then push", () => pushes2("a,b", answering(Symbol.split, undefined)));
attempt("replace", () => reads3("abc", "b"));
attempt("replace answers with a number", () => reads3("abc", answering(Symbol.replace, 65)));
attempt("replace answers with an object", () => reads3("abc", answering(Symbol.replace, { charCodeAt: () => "mine" })));
attempt("replace answers with an array", () => reads3("abc", answering(Symbol.replace, ["abc"])));
attempt("search", () => adds4("abc", /b/));
attempt("search answers with a text", () => adds4("abc", answering(Symbol.search, "3")));
attempt("search answers with a bigint", () => adds4("abc", answering(Symbol.search, 10n)));
attempt("search answers with an object", () => adds4("abc", answering(Symbol.search, { valueOf() { log.push("valueOf"); return 2 ** 31; } })));
attempt("search answers with undefined", () => adds4("abc", answering(Symbol.search, undefined)));
attempt("match", () => iterates5("abc", /b/));
attempt("match finds nothing", () => iterates5("abc", /x/));
attempt("match answers with a text", () => iterates5("abc", answering(Symbol.match, "xy")));
attempt("matchAll", () => iterates6("abcb", /b/g));
attempt("matchAll answers with an array of texts", () => iterates6("abc", answering(Symbol.matchAll, ["xy", "z"])));
attempt("matchAll answers with a number", () => iterates6("abc", answering(Symbol.matchAll, 5)));

function readsAt(s, index) {
  return s.at(index).charCodeAt(0);
}
function readsByIndex(s, index) {
  return s[index].charCodeAt(0);
}
function readsCharAt(s, index) {
  return s.charAt(index).charCodeAt(0);
}
function addsToCodePoint(s, index) {
  const n = s.codePointAt(index);
  return [n + 1, n | 0];
}
function addsToCharCode(s, index) {
  const n = s.charCodeAt(index);
  return [n + 1, n | 0];
}
function addsToPopped(a) {
  const n = a.pop();
  return [n + 1, n | 0];
}
function addsToShifted(a) {
  const n = a.shift();
  return [n + 1, n | 0];
}
function addsToFound(a, wanted) {
  const n = a.find(x => x === wanted);
  return [n + 1, n | 0];
}
function addsToMapped(m, key) {
  const n = m.get(key);
  return [n + 1, n | 0];
}
function addsMembersOfFound(a, wanted) {
  const o = a.find(candidate => candidate.x === wanted);
  return o.x + o.y;
}
function addsToElement(a, index) {
  const n = a[index];
  return [n + 1, n | 0];
}
function addsToLargest(a) {
  const n = Math.max(...a);
  return [n + 1, n | 0];
}
function addsToParsed(text) {
  const n = parseInt(text, 10);
  return [n + 1, n | 0];
}
function addsToIndex(a, wanted) {
  const n = a.indexOf(wanted);
  return [n + 1, n | 0, a[n]];
}
for (let i = 0; i < 2000; i++) {
  readsAt("abc", 1);
  readsByIndex("abc", 1);
  readsCharAt("abc", 1);
  addsToCodePoint("abc", 1);
  addsToCharCode("abc", 1);
  addsToPopped([1, 2]);
  addsToShifted([1, 2]);
  addsToFound([1, 2], 2);
  addsToMapped(new Map([[1, 2]]), 1);
  addsMembersOfFound([{ x: 1, y: 2 }], 1);
  addsToElement([1, 2], 1);
  addsToLargest([1, 2]);
  addsToParsed("12");
  addsToIndex([1, 2], 2);
}
for (const index of [1, 3, -1, -4, 1.5, "1", NaN, undefined, 2 ** 31, -0]) {
  attempt("at " + show(index), () => readsAt("abc", index));
  attempt("by index " + show(index), () => readsByIndex("abc", index));
  attempt("charAt " + show(index), () => readsCharAt("abc", index));
  attempt("codePointAt " + show(index), () => addsToCodePoint("abc", index));
  attempt("charCodeAt " + show(index), () => addsToCharCode("abc", index));
  attempt("an element " + show(index), () => addsToElement([1, 2, 3], index));
}
attempt("pop of an empty array", () => addsToPopped([]));
attempt("pop of an array that ends in a hole", () => addsToPopped([1, ,]));
attempt("pop of an array of texts", () => addsToPopped(["1", "2"]));
attempt("shift of an empty array", () => addsToShifted([]));
attempt("find finds nothing", () => addsToFound([1, 2], 3));
attempt("a key the map does not have", () => addsToMapped(new Map([[1, 2]]), 2));
attempt("a key whose value is a text", () => addsToMapped(new Map([[1, "2"]]), 1));
attempt("find finds no object", () => addsMembersOfFound([{ x: 1, y: 2 }], 3));
attempt("the largest of nothing", () => addsToLargest([]));
attempt("the largest of a text and a number", () => addsToLargest(["12", 3]));
attempt("the largest with a hole", () => addsToLargest([1, , 3]));
attempt("the largest of zeros", () => Math.max(-0, -0));
attempt("parseInt of no number", () => addsToParsed("ten"));
attempt("parseInt of a large number", () => addsToParsed("4294967297"));
attempt("parseInt of minus zero", () => parseInt("-0", 10));
attempt("indexOf finds nothing", () => addsToIndex([1, 2], 3));

function readsSerialized(value) {
  const s = JSON.stringify(value);
  return s.charCodeAt(0);
}
function takesTwo(iterable) {
  const [first, second] = iterable;
  return [first + 1, second + 1];
}
for (let i = 0; i < 2000; i++) {
  readsSerialized({ x: 1 });
  takesTwo([1, 2]);
}
attempt("JSON.stringify of an object", () => readsSerialized({ x: 1 }));
attempt("JSON.stringify of undefined", () => readsSerialized(undefined));
attempt("JSON.stringify of a function", () => readsSerialized(() => {}));
attempt("JSON.stringify of a symbol", () => readsSerialized(Symbol("s")));
attempt("JSON.stringify of an object whose toJSON answers nothing", () => readsSerialized({ toJSON() {} }));
attempt("a pattern takes more than the array gives", () => takesTwo([1]));
attempt("a pattern takes more than the set gives", () => takesTwo(new Set([1])));
attempt("a pattern takes characters", () => takesTwo("12"));

function readsParameter(parameters, name) {
  const s = parameters.get(name);
  return s.charCodeAt(0);
}
function addsToParameter(parameters, name) {
  const n = parameters.get(name);
  return [n + 1, n | 0];
}
for (let i = 0; i < 2000; i++) {
  readsParameter(new URLSearchParams("a=1"), "a");
  addsToParameter(new URLSearchParams("a=1"), "a");
}
const holders = [
  ["URLSearchParams", () => new URLSearchParams("a=1&a=2")],
  ["Headers", () => new Headers({ a: "1" })],
  ["FormData", () => { const form = new FormData(); form.append("a", "1"); return form; }],
  ["a map of numbers", () => new Map([["a", 1]])],
  ["a map of texts", () => new Map([["a", "1"]])],
  ["an object with get", () => ({ get: name => ({ charCodeAt: () => "own " + name, valueOf: () => 41 }) })],
  ["the searchParams of a URL", () => new URL("http://localhost/?a=1").searchParams],
];
for (const [label, make] of [...holders, holders[0]]) {
  attempt(label + ": a name that is there, read", () => readsParameter(make(), "a"));
  attempt(label + ": a name that is there, added to", () => addsToParameter(make(), "a"));
  attempt(label + ": a name that is missing, read", () => readsParameter(make(), "b"));
  attempt(label + ": a name that is missing, added to", () => addsToParameter(make(), "b"));
}
