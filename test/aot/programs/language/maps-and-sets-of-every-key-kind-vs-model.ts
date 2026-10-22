// Maps and sets do what a list of pairs does, through long random sequences of insertions, deletions and lookups, with keys and values of every kind and receivers of several types.
const collect: () => void = () => Bun.gc(true);

let seed = 987654321;
function random(below: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % below;
}

class Item {
  constructor(public rank: number) {}
}

let wrong = 0;
let checksum = 0;
function mix(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}
function fail(what: string): void {
  if (wrong++ < 10) console.log("wrong:", what);
}

function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

class Model<K, V> {
  keys: K[] = [];
  values: V[] = [];
  find(key: K): number {
    for (let i = 0; i < this.keys.length; i++) if (sameValueZero(this.keys[i], key)) return i;
    return -1;
  }
}

function compare<K, V>(map: Map<K, V>, set: Set<K>, model: Model<K, V>): void {
  if (map.size !== model.keys.length) fail("size of the map " + map.size + " " + model.keys.length);
  if (set.size !== model.keys.length) fail("size of the set " + set.size + " " + model.keys.length);
  let i = 0;
  for (const [key, value] of map) {
    if (!Object.is(key, model.keys[i]) || !Object.is(value, model.values[i])) fail("order of the map at " + i);
    i++;
  }
  if (i !== model.keys.length) fail("entries of the map " + i);
  i = 0;
  for (const key of set) {
    if (!Object.is(key, model.keys[i])) fail("order of the set at " + i);
    i++;
  }
  if (i !== model.keys.length) fail("entries of the set " + i);
}

function stored<K>(key: K): K {
  return (Object.is(key, -0) ? 0 : key) as K;
}

function step<K, V>(map: Map<K, V>, set: Set<K>, model: Model<K, V>, key: K, value: V): void {
  const at = model.find(key);
  const what = random(100);
  if (what < 25) {
    const found = map.get(key);
    if (!Object.is(found, at < 0 ? undefined : model.values[at])) fail("get");
    mix(at);
  } else if (what < 35) {
    if (map.has(key) !== at >= 0) fail("has of the map");
    if (set.has(key) !== at >= 0) fail("has of the set");
  } else if (what < 75) {
    if (map.set(key, value) !== map) fail("set yields the map");
    if (set.add(key) !== set) fail("add yields the set");
    if (at < 0) {
      model.keys.push(stored(key));
      model.values.push(value);
    } else model.values[at] = value;
  } else if (what < 97) {
    if (map.delete(key) !== at >= 0) fail("delete of the map");
    if (set.delete(key) !== at >= 0) fail("delete of the set");
    if (at >= 0) {
      model.keys.splice(at, 1);
      model.values.splice(at, 1);
    }
  } else compare(map, set, model);
}

const objects: Item[] = [];
for (let i = 0; i < 600; i++) objects.push(new Item(i));
const symbols: symbol[] = [];
for (let i = 0; i < 40; i++) symbols.push(Symbol("s" + i));
const numbers: number[] = [0, -0, NaN, 0.5, -0.5, 1e21, -1e21, 2 ** 31, -(2 ** 31), 2 ** 31 - 1, 2 ** 32, 2 ** 53, Infinity, -Infinity, 5e-324];
for (let i = -20; i < 400; i++) numbers.push(i);
for (let i = 0; i < 60; i++) numbers.push(i + 0.25);
const bigints: bigint[] = [0n, -0n, 1n, -1n, 2n ** 64n, 2n ** 64n + 1n, -(2n ** 64n), 2n ** 200n];
const texts: string[] = [];
for (let i = 0; i < 200; i++) texts.push("t" + i);
const everything: unknown[] = [undefined, null, true, false, "", "0", "NaN", ...objects.slice(0, 150), ...symbols, ...numbers.slice(0, 120), ...bigints, ...texts.slice(0, 100)];

function freshBigInt(value: bigint): bigint {
  return value + BigInt(random(1));
}
function freshNumber(value: number): number {
  return random(2) ? value : value * (1 + random(1));
}
function freshText(value: string): string {
  return value.split("").join("");
}
function fresh(value: unknown): unknown {
  if (typeof value === "bigint") return freshBigInt(value);
  if (typeof value === "number") return freshNumber(value);
  if (typeof value === "string" && random(2)) return freshText(value);
  return value;
}

function objectsToNumbers(rounds: number, inUse: number): void {
  const map = new Map<Item, number>();
  const set = new Set<Item>();
  const model = new Model<Item, number>();
  for (let round = 0; round < rounds; round++) step(map, set, model, objects[random(inUse)]!, random(3) ? round : round + 0.5);
  compare(map, set, model);
  mix(map.size);
}
function objectsToObjects(rounds: number, inUse: number): void {
  const map = new Map<Item, Item>();
  const set = new Set<Item>();
  const model = new Model<Item, Item>();
  for (let round = 0; round < rounds; round++) step(map, set, model, objects[random(inUse)]!, objects[random(objects.length)]!);
  compare(map, set, model);
  mix(map.size);
}
function numbersToObjects(rounds: number, inUse: number): void {
  const map = new Map<number, Item>();
  const set = new Set<number>();
  const model = new Model<number, Item>();
  for (let round = 0; round < rounds; round++) step(map, set, model, freshNumber(numbers[random(inUse)]!), objects[random(objects.length)]!);
  compare(map, set, model);
  mix(map.size);
}
function textsToNumbers(rounds: number, inUse: number): void {
  const map = new Map<string, number>();
  const set = new Set<string>();
  const model = new Model<string, number>();
  for (let round = 0; round < rounds; round++) step(map, set, model, random(2) ? texts[random(inUse)]! : freshText(texts[random(inUse)]!), round);
  compare(map, set, model);
  mix(map.size);
}
function symbolsToBooleans(rounds: number, inUse: number): void {
  const map = new Map<symbol, boolean>();
  const set = new Set<symbol>();
  const model = new Model<symbol, boolean>();
  for (let round = 0; round < rounds; round++) step(map, set, model, symbols[random(inUse)]!, !random(2));
  compare(map, set, model);
  mix(map.size);
}
function anythingToAnything(rounds: number, inUse: number): void {
  const map = new Map<unknown, unknown>();
  const set = new Set<unknown>();
  const model = new Model<unknown, unknown>();
  for (let round = 0; round < rounds; round++) {
    step(map, set, model, fresh(everything[random(inUse)]), everything[random(everything.length)]);
    if (round % 4000 === 3999) collect();
  }
  compare(map, set, model);
  mix(map.size);
}

// The first entry decides how a table starts, a later one may not fit it.
function firstEntries(): void {
  const firsts: unknown[] = [objects[0], "text", freshText("text"), symbols[0], 1, 0.5, -0, NaN, 2n ** 70n, undefined, null, true];
  for (const firstKey of firsts) {
    for (const firstValue of firsts) {
      for (const laterKey of firsts) {
        const map = new Map<unknown, unknown>();
        const set = new Set<unknown>();
        map.set(firstKey, firstValue);
        set.add(firstKey);
        map.set(laterKey, firstKey);
        set.add(laterKey);
        const distinct = sameValueZero(firstKey, laterKey) || (typeof firstKey === "bigint" && firstKey === laterKey) ? 1 : 2;
        if (map.size !== distinct || set.size !== distinct) fail("sizes behind two insertions");
        if (!Object.is(map.get(firstKey), distinct === 1 ? firstKey : firstValue)) fail("the first value");
        if (!Object.is(map.get(laterKey), firstKey)) fail("the later value");
        if (!map.delete(firstKey) || map.has(firstKey) || map.size !== distinct - 1) fail("the first key leaves the map");
        if (!set.delete(firstKey) || set.has(firstKey) || set.size !== distinct - 1) fail("the first key leaves the set");
        map.set(firstKey, laterKey);
        set.add(firstKey);
        const last = [...map.keys()].pop();
        if (!Object.is(last, stored(firstKey)) || !Object.is([...set].pop(), stored(firstKey))) fail("a key that comes back is the last");
      }
    }
  }
}

// An iterator goes on in the tables that replace the one it started in.
function changesDuringIteration(): void {
  const set = new Set<number>([0]);
  let seen = 0;
  for (const value of set) {
    seen++;
    if (value < 3000) {
      set.add(value + 1);
      if (value % 3 === 0) set.delete(value);
      if (value % 7 === 0) set.delete(value + 1), set.add(value + 1);
    }
  }
  mix(seen);
  mix(set.size);

  const map = new Map<Item, number>([[objects[0]!, 0]]);
  seen = 0;
  for (const [key, value] of map) {
    seen += value;
    if (key.rank + 1 < objects.length) map.set(objects[key.rank + 1]!, key.rank + 1);
    if (key.rank % 2) map.delete(objects[key.rank - 1]!);
    if (key.rank % 50 === 49) collect();
  }
  mix(seen);
  mix(map.size);
}

// A key that is deleted and inserted over and over fills the table with deleted entries.
function oneKeyMoves(): void {
  const map = new Map<string, number>();
  const set = new Set<Item>();
  for (let i = 0; i < 64; i++) {
    map.set(texts[i]!, i);
    set.add(objects[i]!);
  }
  for (let round = 0; round < 20000; round++) {
    const i = round % 64;
    if (!map.delete(texts[i]!) || !set.delete(objects[i]!)) fail("the key was there");
    map.set(texts[i]!, round);
    set.add(objects[i]!);
    if (map.size !== 64 || set.size !== 64) fail("sizes stay");
  }
  let order = 0;
  for (const [key, value] of map) order = (Math.imul(order, 31) + key.length + value) | 0;
  for (const item of set) order = (Math.imul(order, 31) + item.rank) | 0;
  mix(order);
}

for (const inUse of [1, 2, 3, 4, 5, 8, 9, 14, 15, 23, 40, 64, 100, 254, 255, 256, 400]) {
  objectsToNumbers(3000, Math.min(inUse, objects.length));
  objectsToObjects(3000, Math.min(inUse, objects.length));
  numbersToObjects(3000, Math.min(inUse, numbers.length));
  textsToNumbers(3000, Math.min(inUse, texts.length));
  symbolsToBooleans(1500, Math.min(inUse, symbols.length));
  anythingToAnything(4000, Math.min(inUse, everything.length));
}
anythingToAnything(30000, everything.length);
firstEntries();
changesDuringIteration();
oneKeyMoves();
console.log("wrong", wrong, "checksum", checksum);
