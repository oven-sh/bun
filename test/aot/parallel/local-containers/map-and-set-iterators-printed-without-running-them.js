// console.log, Bun.inspect, console.table, util.inspect and Console#table read a Map or Set iterator from its collection and do not run it. In an executable the collection has the compiled kind of storage: what each prints, and what the iterator yields afterwards, is what plain Bun prints.
const util = require("node:util");
const { Console } = require("node:console");
const own = new Console({ stdout: process.stdout, stderr: process.stderr, colorMode: false });

function printed(label, iterator) {
  console.log("## " + label);
  console.log(iterator);
  console.log("%o", iterator);
  console.log(Bun.inspect(iterator, { compact: true }), Bun.inspect({ nested: [iterator] }, { compact: true }));
  console.log(util.inspect(iterator), util.inspect(iterator, { maxArrayLength: 1 }));
  console.table(iterator);
  own.table(iterator);
  const left = [];
  for (const entry of iterator) left.push(entry);
  console.log(left.length, JSON.stringify(left.slice(0, 3)), JSON.stringify(left.slice(-2)));
}

const map = () =>
  new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
const set = () => new Set(["x", "y", "z"]);
const kinds = {
  "map.keys()": () => map().keys(),
  "map.values()": () => map().values(),
  "map.entries()": () => map().entries(),
  "map[Symbol.iterator]()": () => map()[Symbol.iterator](),
  "set.keys()": () => set().keys(),
  "set.values()": () => set().values(),
  "set.entries()": () => set().entries(),
  "set[Symbol.iterator]()": () => set()[Symbol.iterator](),
};
for (const kind in kinds) {
  printed(kind, kinds[kind]());
  const advanced = kinds[kind]();
  advanced.next();
  printed(kind + " after next()", advanced);
  const done = kinds[kind]();
  for (const _ of done);
  printed(kind + " done", done);
}

const late = new Map();
const lateEntries = late.entries();
late.set("x", 1);
printed("made before the first entry", lateEntries);

const changed = new Map([
  ["a", 1],
  ["b", 2],
  ["c", 3],
  ["d", 4],
]);
const changedKeys = changed.keys();
changedKeys.next();
changedKeys.next();
changed.delete("a");
changed.delete("c");
changed.set("e", 5);
printed("after delete before and behind the position", changedKeys);

const cleared = new Set([1, 2]);
const clearedValues = cleared.values();
clearedValues.next();
cleared.clear();
cleared.add(3);
printed("after clear() and add()", clearedValues);

const grown = new Set([0, 1]);
const grownValues = grown.values();
grownValues.next();
for (let i = 2; i < 40; i++) grown.add(i);
for (let i = 2; i < 36; i++) grown.delete(i);
printed("after growth and deletes", grownValues);

// Past 256 and past 65536 entries the table has wider slots.
for (const size of [300, 70000]) {
  const large = new Map();
  for (let i = 0; i < size; i++) large.set("k" + i, i);
  const entries = large.entries();
  for (let i = 0; i < size - 4; i++) entries.next();
  printed("the last entries of " + size, entries);
  const members = new Set(large.keys()).values();
  for (let i = 0; i < size - 2; i++) members.next();
  printed("the last members of " + size, members);
}

const atEnd = new Set([1]);
const atEndValues = atEnd.values();
atEndValues.next();
console.log(Bun.inspect(atEndValues), util.inspect(atEndValues));
atEnd.add(2);
printed("at its end, then the Set grows", atEndValues);

const holder = new Map();
const selfValues = holder.values();
holder.set("self", selfValues);
console.log(Bun.inspect(selfValues, { compact: true }), Bun.inspect(holder, { compact: true }));
