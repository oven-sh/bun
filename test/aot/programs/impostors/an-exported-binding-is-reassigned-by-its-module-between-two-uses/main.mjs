import { a, f, n, o, replace, s } from "./bindings.mjs";
import * as bindings from "./bindings.mjs";

const log = (globalThis.log = []);

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

function pushes(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    a.push(1);
    results.push(a.length);
    if (round === 0) replace(index);
  }
  return results;
}

function iterates(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const seen = [];
    for (const x of a) seen.push(x);
    results.push(seen);
    if (round === 0) replace(index);
  }
  return results;
}

function readsCharCode(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(s.charCodeAt(0));
    if (round === 0) replace(index);
  }
  return results;
}

function truncates(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n | 0);
    if (round === 0) replace(index);
  }
  return results;
}

function addsOne(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(n + 1);
    if (round === 0) replace(index);
  }
  return results;
}

function calls(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(f(1));
    if (round === 0) replace(index);
  }
  return results;
}

function addsMembers(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(o.x + o.y);
    if (round === 0) replace(index);
  }
  return results;
}

function storesMember(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    o.x = 1;
    results.push(o);
    if (round === 0) replace(index);
  }
  return results;
}

function pushesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    bindings.a.push(1);
    results.push(bindings.a.length);
    if (round === 0) replace(index);
  }
  return results;
}

function iteratesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const seen = [];
    for (const x of bindings.a) seen.push(x);
    results.push(seen);
    if (round === 0) replace(index);
  }
  return results;
}

function readsCharCodeThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.s.charCodeAt(0));
    if (round === 0) replace(index);
  }
  return results;
}

function truncatesThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.n | 0);
    if (round === 0) replace(index);
  }
  return results;
}

function addsOneThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.n + 1);
    if (round === 0) replace(index);
  }
  return results;
}

function callsThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.f(1));
    if (round === 0) replace(index);
  }
  return results;
}

function addsMembersThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    results.push(bindings.o.x + bindings.o.y);
    if (round === 0) replace(index);
  }
  return results;
}

function storesMemberThroughTheNamespace(index) {
  replace(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    bindings.o.x = 1;
    results.push(bindings.o);
    if (round === 0) replace(index);
  }
  return results;
}

const table = [
  ["pushes", pushes],
  ["pushesThroughTheNamespace", pushesThroughTheNamespace],
  ["iterates", iterates],
  ["iteratesThroughTheNamespace", iteratesThroughTheNamespace],
  ["readsCharCode", readsCharCode],
  ["readsCharCodeThroughTheNamespace", readsCharCodeThroughTheNamespace],
  ["truncates", truncates],
  ["truncatesThroughTheNamespace", truncatesThroughTheNamespace],
  ["addsOne", addsOne],
  ["addsOneThroughTheNamespace", addsOneThroughTheNamespace],
  ["calls", calls],
  ["callsThroughTheNamespace", callsThroughTheNamespace],
  ["addsMembers", addsMembers],
  ["addsMembersThroughTheNamespace", addsMembersThroughTheNamespace],
  ["storesMember", storesMember],
  ["storesMemberThroughTheNamespace", storesMemberThroughTheNamespace],
];

function everyCase(round) {
  for (const [name, use] of table) {
    for (const index of [0, 1, 2, 3, 0]) attempt(round + " " + name + " set " + index, () => use(index));
  }
}

everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes(0);
  pushesThroughTheNamespace(0);
  iterates(0);
  iteratesThroughTheNamespace(0);
  readsCharCode(0);
  readsCharCodeThroughTheNamespace(0);
  truncates(0);
  truncatesThroughTheNamespace(0);
  addsOne(0);
  addsOneThroughTheNamespace(0);
  calls(0);
  callsThroughTheNamespace(0);
  addsMembers(0);
  addsMembersThroughTheNamespace(0);
  storesMember(0);
  storesMemberThroughTheNamespace(0);
}
everyCase("after 2000");
