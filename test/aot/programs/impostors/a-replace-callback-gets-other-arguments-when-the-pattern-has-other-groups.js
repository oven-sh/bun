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

const readsGroup = (match, group) => String(group.charCodeAt(0));
const truncatesOffset = (match, group, offset) => String(offset | 0);
const addsToOffset = (match, group, offset) => String(offset + 1);
const iteratesWhole = (match, group, offset, whole) => {
  let seen = "";
  for (const x of whole) seen += x + ".";
  return seen;
};
const addsNamedGroups = (match, group, offset, whole, groups) => String(groups.x + groups.y);
const storesNamedGroup = (match, group, offset, whole, groups) => {
  groups.x = 1;
  return Object.keys(groups).join() + (Object.getPrototypeOf(groups) === null);
};

const callbacks = [
  ["readsGroup", readsGroup],
  ["truncatesOffset", truncatesOffset],
  ["addsToOffset", addsToOffset],
  ["iteratesWhole", iteratesWhole],
  ["addsNamedGroups", addsNamedGroups],
  ["storesNamedGroup", storesNamedGroup],
];
const patterns = [
  ["one group", () => /(b)/],
  ["one named group", () => /(?<x>b)/],
  ["no group", () => /b/],
  ["a group that takes no part", () => /(x)?b/],
  ["two groups", () => /(b)(c)/],
  ["two named groups, one takes no part", () => /(?<x>b)(?<y>x)?/],
  ["a text", () => "b"],
  ["a global pattern", () => /(b|c)/g],
];

for (let i = 0; i < 2000; i++) {
  "abc".replace(/(b)/, readsGroup);
  "abc".replace(/(b)/, truncatesOffset);
  "abc".replace(/(b)/, addsToOffset);
  "abc".replace(/(b)/, iteratesWhole);
  "abc".replace(/(?<x>b)/, addsNamedGroups);
  "abc".replace(/(?<x>b)/, storesNamedGroup);
}
for (const [name, callback] of callbacks) {
  for (const [label, pattern] of [...patterns, patterns[0]]) {
    attempt(name + " " + label, () => "abc".replace(pattern(), callback));
    attempt(name + " " + label + ", every match", () => "abcb".replaceAll(typeof pattern() === "string" ? pattern() : new RegExp(pattern().source, "g"), callback));
  }
}

const results = [
  ["a text", () => "T"],
  ["a number", () => -0],
  ["undefined", () => undefined],
  ["null", () => null],
  ["an object with toString", () => ({ toString() { log.push("toString"); return "O"; }, valueOf() { log.push("valueOf"); return "V"; } })],
  ["an array", () => [1, [2, 3]]],
  ["a bigint", () => 10n],
  ["a symbol", () => Symbol("s")],
  ["a text with a dollar pattern", () => "$&$1"],
];
let result = results[0][1];
const answers = () => result();
for (let i = 0; i < 2000; i++) "abc".replace(/(b)/, answers);
for (const [label, make] of [...results, results[0]]) {
  result = make;
  attempt("the callback returns " + label, () => "abc".replace(/(b)/, answers));
  attempt("the callback returns " + label + " for a text", () => "abc".replace("b", answers));
}
