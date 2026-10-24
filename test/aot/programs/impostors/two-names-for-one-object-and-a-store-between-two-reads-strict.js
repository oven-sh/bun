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

function sumsAndStores(o, p, turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    total += o.x;
    p.x = i + 10;
  }
  return total;
}
function countsAndPushes(a, b) {
  let turns = 0;
  for (let i = 0; i < a.length; i++) {
    turns++;
    if (i < 3) b.push(i);
  }
  return [turns, a.length];
}
function iteratesAndPushes(a, b) {
  const seen = [];
  for (const x of a) {
    seen.push(x);
    if (seen.length < 4) b.push(seen.length * 10);
  }
  return seen;
}
function readsTwiceAroundAStore(o, p) {
  const before = o.x + o.y;
  p.y = "stored";
  return [before, o.x + o.y];
}
function readsTwiceAroundADelete(o, p) {
  const before = o.x + o.y;
  delete p.y;
  return [before, o.x + o.y];
}
function readsLengthAroundAStore(a, b) {
  const before = a.length;
  b.length = 1;
  return [before, a.length, a[1]];
}
function readsElementAroundAStore(a, b, index) {
  const before = a[0];
  b[index] = "stored";
  return [before, a[0]];
}
function callsTwiceAroundAStore(holder, other) {
  const before = holder.f(1);
  other.f = x => "replaced " + x;
  return [before, holder.f(1)];
}
function addsAroundAStore(holder, other) {
  const before = holder.n + 1;
  other.n = "3";
  return [before, holder.n + 1, holder.n | 0];
}

for (let i = 0; i < 2000; i++) {
  sumsAndStores({ x: 1, y: 2 }, { x: 0, y: 0 }, 3);
  countsAndPushes([5, 6], []);
  iteratesAndPushes([5, 6], []);
  readsTwiceAroundAStore({ x: 1, y: 2 }, { x: 0, y: 0 });
  readsTwiceAroundADelete({ x: 1, y: 2 }, { x: 0, y: 0 });
  readsLengthAroundAStore([5, 6], [7, 8]);
  readsElementAroundAStore([5, 6], [7, 8], 0);
  callsTwiceAroundAStore({ f: x => x + 1 }, { f: null });
  addsAroundAStore({ n: 7 }, { n: 0 });
}

const same = make => {
  const value = make();
  return [value, value];
};
const heir = make => {
  const parent = make();
  return [Object.create(parent), parent];
};
const behindAProxy = make => {
  const value = make();
  return [value, new Proxy(value, {})];
};
const throughASetter = make => {
  const value = make();
  return [value, { set x(stored) { value.x = stored; }, set y(stored) { value.y = stored; }, set n(stored) { value.n = stored; }, set f(stored) { value.f = stored; }, set length(stored) { value.length = stored; }, set 0(stored) { value[0] = stored; }, push(pushed) { return value.push(pushed); } }];
};
const pairs = [
  ["two objects", make => [make(), make()]],
  ["one object twice", same],
  ["an heir and its prototype", heir],
  ["an object and a proxy of it", behindAProxy],
  ["an object and setters that store to it", throughASetter],
];
for (const [label, pair] of [...pairs, pairs[0]]) {
  attempt("a sum in a loop that stores: " + label, () => sumsAndStores(...pair(() => ({ x: 1, y: 2 })), 4));
  attempt("a length in the condition of a loop that pushes: " + label, () => countsAndPushes(...pair(() => [5, 6])));
  attempt("for-of in a loop that pushes: " + label, () => iteratesAndPushes(...pair(() => [5, 6])));
  attempt("two reads around a store: " + label, () => readsTwiceAroundAStore(...pair(() => ({ x: 1, y: 2 }))));
  attempt("two reads around a delete: " + label, () => readsTwiceAroundADelete(...pair(() => ({ x: 1, y: 2 }))));
  attempt("a length around a store to a length: " + label, () => readsLengthAroundAStore(...pair(() => [5, 6])));
  attempt("an element around a store by index: " + label, () => readsElementAroundAStore(...pair(() => [5, 6]), 0));
  attempt("an element around a store by a text: " + label, () => readsElementAroundAStore(...pair(() => [5, 6]), "0"));
  attempt("two calls around a store: " + label, () => callsTwiceAroundAStore(...pair(() => ({ f: x => x + 1 }))));
  attempt("two sums around a store: " + label, () => addsAroundAStore(...pair(() => ({ n: 7 }))));
}
