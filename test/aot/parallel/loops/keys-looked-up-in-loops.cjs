"use strict";

// Loops look numbers and objects up in maps and sets of every size, and some change the collection on the way.
function get(map, from, to, step) {
  let found = 0;
  let sum = 0;
  for (let i = from; i < to; i += step) {
    const value = map.get(i);
    if (value === undefined) continue;
    found++;
    sum += value;
  }
  return [found, sum];
}

function has(set, from, to, step) {
  let found = 0;
  for (let i = from; i < to; i += step) if (set.has(i)) found++;
  return found;
}

function getOrAdd(map, to) {
  let added = 0;
  for (let i = 0; i < to; i++) {
    const key = (i * 37) % 101;
    if (map.get(key) === undefined) {
      map.set(key, i);
      added++;
    }
  }
  return added;
}

function deleteOnTheWay(map, to, at) {
  const seen = [];
  for (let i = 0; i < to; i++) {
    if (map.has(i)) seen.push(i);
    if (i === at) {
      map.delete(at + 1);
      map.set(at + 3, -1);
    }
  }
  return seen.join();
}

function* valuesOf(map, to) {
  for (let i = 0; i < to; i++) {
    const value = map.get(i * 3);
    if (value == null) continue;
    yield value;
  }
}

function objectsIn(map, objects) {
  let sum = 0;
  for (let i = 0; i < objects.length; i++) {
    const value = map.get(objects[i]);
    if (value !== undefined) sum += value;
  }
  return sum;
}

for (const size of [0, 1, 4, 7, 8, 9, 40, 190, 191, 254, 255, 600, 5000]) {
  for (const step of [1, 3, 64, 65536]) {
    const map = new Map();
    const set = new Set();
    for (let i = 0; i < size; i++) {
      map.set(i * step, i);
      set.add(i * step);
    }
    console.log(size, step, get(map, -10, 300, 1), get(map, 0, size * step, step), get(map, 0.5, 40, 0.5), has(set, -10, 300, 1), has(set, 0, size * step, step));
    if (size > 3) {
      for (let i = 0; i < size; i += 2) map.delete(i * step);
      console.log(get(map, 0, size * step, step), deleteOnTheWay(map, 30, 11));
    }
    const answers = [];
    for (const value of valuesOf(map, 60)) {
      answers.push(value);
      if (answers.length === 3) map.set(30 * 3, 77);
      if (answers.length === 5) map.clear();
    }
    console.log(answers.join(), map.size);
  }
}

console.log(getOrAdd(new Map(), 400), getOrAdd(new Map([["a", 1]]), 400));

const mixed = new Map([["1", "text"], [1, "one"], [-0, "zero"], [NaN, "not a number"], [2147483648, "2 ** 31"], [9007199254740992, "2 ** 53"], [true, "yes"], [null, "nothing"]]);
for (const key of [1, 0, -0, NaN, 2147483648, 2147483647, 9007199254740992, 9007199254740993, 1.5]) console.log(key, mixed.get(key), mixed.has(key));

const objects = [];
for (let i = 0; i < 400; i++) objects.push(i % 3 ? { i } : [i]);
for (const size of [3, 8, 9, 200, 300, 400]) {
  const map = new Map();
  for (let i = 0; i < size; i++) map.set(objects[i], size % 2 ? i : i * 0.5);
  console.log(size, objectsIn(map, objects));
  map.set(5, 1);
  console.log(size, objectsIn(map, objects));
}

const constant = new Map([[10, "ten"], [20, "twenty"], [30, "thirty"]]);
let spoken = "";
for (let i = 0; i < 40; i++) spoken += constant.get(i) ?? "";
constant.set(11, "eleven");
for (let i = 0; i < 40; i++) spoken += constant.get(i) ?? "";
console.log(spoken);

// Strings: constants of the file, strings in other cells, joins, substrings and wide strings.
const vowels = new Set(["a", "e", "i", "o", "u"]);
const ranks = new Map([["ace", 1], ["two", 2], ["你", 3], ["", 4], ["constructor", 5]]);
const text = "the quick brown fox jumps over the lazy dog: 你 ä";
function vowelsOf(set, string) {
  let found = 0;
  for (let i = 0; i < string.length; i++) if (set.has(string[i])) found++;
  for (const character of string) if (set.has(character)) found += 100;
  return found;
}

function ranksOf(map, words) {
  const found = [];
  for (let i = 0; i < words.length; i++) found.push(map.get(words[i]));
  for (let i = 0; i < words.length; i++) if (map.has(words[i].slice(0, 3))) found.push(i);
  return found.join();
}

function count(words) {
  const counts = new Map();
  for (let i = 0; i < words.length; i++) counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
  return [...counts].join(" ");
}

const words = ["ace", "two", "three", "", "constructor", "__proto__", "你", "a" + "ce", ["tw", "o"].join("")];
for (let i = 0; i < 30; i++) words.push(`word${i % 11}`, text.slice(i, i + 3));
console.log(vowelsOf(vowels, text), ranksOf(ranks, words), count(words));
vowels.add("y");
ranks.delete("ace");
for (let i = 0; i < 300; i++) ranks.set("word" + i, i);
console.log(vowelsOf(vowels, text), ranksOf(ranks, words), count(words.concat(words)));
ranks.set(7, "seven");
console.log(ranksOf(ranks, words), vowelsOf(new Set(), text), vowelsOf(new Set(text), text), vowelsOf(new Set([1, "a", {}, null]), text));
