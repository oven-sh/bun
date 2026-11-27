"use strict";

// has(), then get() of one key in loops: numbers, objects, strings and mixed keys, in maps that the loop changes and maps that it does not.
function sum(map, keys) {
  let found = 0, total = "";
  for (const key of keys) {
    if (map.has(key)) {
      found++;
      total += String(map.get(key)) + ",";
    }
  }
  return [found, total.length, total.slice(0, 60)];
}

function sumOfCounter(map, to, step) {
  let found = 0, total = 0;
  for (let i = -3; i < to; i += step) if (map.has(i)) { found++; total += map.get(i) || 1; }
  return [found, total];
}

function count(map, keys) {
  for (const key of keys) {
    if (map.has(key)) map.set(key, map.get(key) + 1);
    else map.set(key, 1);
  }
  return [...map.values()].join();
}

function getOrMake(map, keys) {
  const made = [];
  for (const key of keys) {
    if (!map.has(key)) map.set(key, [made.length]);
    const list = map.get(key);
    list.push(made.length);
    made.push(list.length);
  }
  return made.join();
}

function without(map, keys) {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    if (map.has(keys[i])) {
      map.delete(keys[(i * 3) % keys.length]);
      const left = map.get(keys[i]);
      total += left === undefined ? 100 : left;
    }
  }
  return [total, map.size];
}

const objects = Array.from({ length: 40 }, (_, i) => ({ i }));
const strings = Array.from({ length: 40 }, (_, i) => "key" + (i % 25));
const pieces = "one two three four five six seven one two eight nine ten one".split(" ");
const numbers = Array.from({ length: 60 }, (_, i) => (i * 7) % 31);
const halves = numbers.map(n => n / 2);
const mixed = [1, "1", objects[2], null, undefined, NaN, -0, 0, 2.5, "key1", true, 1n];
for (const keys of [numbers, halves, objects, strings, pieces, mixed]) {
  for (const size of [0, 3, 8, 9, 30, 300]) {
    const of = n => new Map(Array.from({ length: n }, (_, i) => [i < keys.length ? keys[(i * 2) % keys.length] : i * 65536 + 0.25, i % 4 ? i : i / 8]));
    console.log(size, sum(of(size), keys), sumOfCounter(of(size), 40, 1), sumOfCounter(of(size), 20, 0.5));
    console.log(count(of(0), keys), getOrMake(new Map, keys), without(of(size), keys));
  }
}
