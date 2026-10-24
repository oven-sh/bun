// Stores under computed keys that add properties the object's layout has no room for: their storage is allocated, then doubled,
// by the stub up to a capacity and by the run time beyond it; and the same names on an ordinary object, whose own storage grows
// the same way. The neighbors where the stub must leave the growth to the run time or must not add at all: index keys beside the
// names, an object that has survived a collection, an object that is frozen halfway.
"use strict";
const outOfSight = new Proxy({}, {});

function Entry(id) {
  this.id = id;
}
outOfSight.Entry = Entry;
outOfSight.names = Array.from({ length: 150 }, (unused, index) => "k" + index);

function fill(entry, from, to, step) {
  const names = outOfSight.names;
  for (let index = from; index < to; index++) entry[names[index]] = step + index;
}
outOfSight.fill = fill;

function describe(entry) {
  let sum = 0;
  const keys = Object.keys(entry);
  for (const key of keys) sum += entry[key];
  return keys.length + " keys, sum " + sum + ", first " + keys[0] + ", last " + keys[keys.length - 1];
}

function attempt(entry, from, to, step) {
  try {
    outOfSight.fill(entry, from, to, step);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}

const seen = new Map();
function note(line) {
  seen.set(line, (seen.get(line) ?? 0) + 1);
}

const counts = [0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 19, 22, 23, 38, 39, 40, 70, 71, 72, 134, 135, 136, 150];
for (let round = 0; round < 40; round++) {
  for (const count of counts) {
    const plain = new outOfSight.Entry(1);
    note("plain " + count + " " + attempt(plain, 0, count, round & 1) + " " + describe(plain));

    const ordinary = JSON.parse("{}");
    note("ordinary " + count + " " + attempt(ordinary, 0, count, round & 1) + " " + describe(ordinary));
  }

  const withIndexes = new outOfSight.Entry(1);
  withIndexes[JSON.parse("2")] = 20;
  withIndexes[JSON.parse("0")] = 10;
  note("indexes " + attempt(withIndexes, 0, 80, 1) + " " + describe(withIndexes) + " " + withIndexes[0] + " " + withIndexes[2]);

  const indexesLater = new outOfSight.Entry(1);
  attempt(indexesLater, 0, 9, 1);
  indexesLater[JSON.parse("1")] = 5;
  note("indexes later " + attempt(indexesLater, 9, 80, 1) + " " + describe(indexesLater) + " " + indexesLater[1]);

  const frozenHalfway = new outOfSight.Entry(1);
  attempt(frozenHalfway, 0, 10, 1);
  Object.freeze(frozenHalfway);
  note("frozen " + attempt(frozenHalfway, 10, 20, 1) + " " + describe(frozenHalfway));

  const overwritten = new outOfSight.Entry(1);
  attempt(overwritten, 0, 50, 1);
  note("overwritten " + attempt(overwritten, 0, 50, 2) + " " + describe(overwritten));
}

const survivors = [];
for (let index = 0; index < 20; index++) {
  const survivor = new outOfSight.Entry(1);
  attempt(survivor, 0, index, 1);
  survivors.push(survivor);
}
Bun.gc(true);
const held = { toString() { return "held"; } };
for (let index = 0; index < survivors.length; index++) {
  attempt(survivors[index], index, index + 30, 1);
  survivors[index][outOfSight.names[149]] = 0;
  survivors[index].held = held;
}
Bun.gc(true);
for (const survivor of survivors) note("survivor " + Object.keys(survivor).length + " " + String(survivor.held) + " " + survivor.k0 + " " + survivor.k149);

for (const [line, count] of [...seen].sort()) console.log(count, line);
