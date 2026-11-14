"use strict";

// Loops that test what a map or a set holds under a key: absent keys, keys that hold undefined or null, and results that are read on either way.
const holes = new Map([[2, undefined], [4, null], [6, 60], [8, 0], [10, "ten"], [12, NaN]]);
for (let i = 100; i < 160; i += 4) holes.set(i, i / 2);
const few = new Map([[1, "one"], [3, undefined], [5, null]]);
const none = new Map();

function strict(map, to) {
  let absent = 0, sum = "";
  for (let i = 0; i < to; i++) {
    const found = map.get(i);
    if (found === undefined) { absent++; continue; }
    sum += found + ",";
  }
  return [absent, sum];
}

function loose(map, to) {
  let absent = 0, sum = "";
  for (let i = 0; i < to; i++) {
    const found = map.get(i);
    if (found == null) absent++;
    else sum += found + ",";
  }
  return [absent, sum];
}

// The absent one is read too.
function readOnBothWays(map, to) {
  let sum = "", last;
  for (let i = 0; i < to; i++) {
    const found = map.get(i);
    if (found == null) { sum += String(found) + ";"; last = found; }
    else sum += found + ",";
  }
  return [sum, last];
}

function readBehind(map, to) {
  const all = [];
  for (let i = 0; i < to; i++) {
    const found = map.get(i);
    let kind = "found";
    if (found === undefined) kind = "absent";
    all.push(kind, found);
  }
  return all.join();
}

function isString(map, to) {
  let strings = 0, others = 0;
  for (let i = 0; i < to; i++) {
    const found = map.get(i);
    if (typeof found === "string") strings += found.length;
    else others++;
  }
  return [strings, others];
}

function* yielded(map, to) {
  let i = 0;
  while (i < to) {
    const found = map.get(i++);
    if (found == null) continue;
    const sent = yield found;
    if (sent) map.set(i, sent);
  }
  return i;
}

class Counter { constructor() { this.next = 0; } }
function* stepped(state, map, to) {
  while (state.next <= to) {
    const found = map.get(state.next++);
    if (found == null || found.length === 0) continue;
    yield [state.next, found];
  }
}

function caught(map, to) {
  let thrown = 0;
  for (let i = 0; i < to; i++) {
    let found;
    try {
      found = map.get(i);
      if (found === undefined) continue;
      if (found === null) throw found;
    } catch (error) {
      thrown += error === null ? 1 : 100;
    }
  }
  return thrown;
}

function hasOf(set, to) {
  let is = 0, isNot = 0, both = "";
  for (let i = 0; i < to; i++) {
    if (set.has(i)) is++;
    if (!set.has(i + 1)) isNot++;
    both += set.has(i) && !set.has(i + 2) ? "y" : "n";
    const there = set.has(i * 2);
    if (there === set.has(i * 2)) both += Number(there);
  }
  return [is, isNot, both];
}

function getOrAdd(map, to) {
  let added = 0, sum = 0;
  for (let i = 0; i < to; i++) {
    const key = i % 23;
    let value = map.get(key);
    if (value === undefined) { value = key * 3; map.set(key, value); added++; }
    sum += value;
  }
  return [added, sum, map.size];
}

const objects = Array.from({ length: 30 }, (_, i) => ({ i }));
function objectKeys(map, set) {
  let sum = 0, absent = 0;
  for (const object of objects) {
    const found = map.get(object);
    if (found === undefined) absent++;
    else sum += found;
    if (set.has(object)) sum += 1000;
  }
  return [sum, absent];
}

for (const map of [holes, few, none]) {
  console.log(strict(map, 130), loose(map, 130), isString(map, 130), caught(map, 130));
  console.log(readOnBothWays(map, 14), readBehind(map, 14));
  const steps = yielded(map, 120);
  let answer = "", step = steps.next();
  for (; !step.done; step = steps.next(answer.length % 7 === 0 ? "sent" : undefined)) answer += step.value + ",";
  console.log(answer, step.value, map.size);
  console.log([...stepped(new Counter, map, 12)].join("|"), [...stepped({ next: 5 }, map, 10.5)].join("|"));
  console.log(hasOf(new Set(map.keys()), 40));
}
console.log(getOrAdd(new Map, 200), getOrAdd(new Map([[3, undefined], [4, null]]), 60));
console.log(objectKeys(new Map(objects.filter(o => o.i % 3).map(o => [o, o.i])), new Set(objects.slice(0, 9))), objectKeys(new Map([[objects[1], undefined]]), new Set));
