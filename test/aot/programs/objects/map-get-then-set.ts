// `has` then `get`, `get` then `set` and `has` then `add` on one table with one key can share a lookup.
// A write to a table in between can move or remove the entry, so the later operation has to look the key up again.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const half = (n: number) => n / 2;
const points: Point[] = [new Point(0, 0), new Point(1, 2), new Point(2, 4), new Point(3, 6), new Point(4, 8)];

function summarize<K>(map: Map<K, number>, nameOf: (key: K) => string): string {
  let sum = 0;
  let head = "";
  let position = 0;
  for (const [key, value] of map) {
    sum += value;
    if (position++ < 6) head += ` ${nameOf(key)}=${value}`;
  }
  return `size ${map.size} sum ${sum}${head}`;
}
const nameOfNumber = (key: number) => (Object.is(key, -0) ? "-0" : String(key));
const nameOfPoint = (key: Point) => `(${key.x},${key.y})`;
const nameOfString = (key: string) => JSON.stringify(key);

// get then set.
function countNumbers(rounds: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countPoints(rounds: number): Map<Point, number> {
  const counts = new Map<Point, number>();
  for (let i = 0; i < rounds; i++) {
    const key = points[i % 5];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countStrings(rounds: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rounds; i++) {
    const key = "k" + (i % 6);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// has then get, with keys that are present and keys that are absent.
function sumPresentNumbers(map: Map<number, number>, rounds: number): string {
  let sum = 0;
  let absent = 0;
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 20);
    if (map.has(key)) sum += map.get(key)!;
    else absent++;
  }
  return `${sum} ${absent}`;
}

function sumPresentPoints(map: Map<Point, number>, other: Point, rounds: number): string {
  let sum = 0;
  let absent = 0;
  for (let i = 0; i < rounds; i++) {
    const key = i % 3 ? points[i % 5] : other;
    if (map.has(key)) sum += map.get(key)!;
    else absent++;
  }
  return `${sum} ${absent}`;
}

function sumPresentStrings(map: Map<string, number>, rounds: number): string {
  let sum = 0;
  let absent = 0;
  for (let i = 0; i < rounds; i++) {
    const key = "k" + (i % 9);
    if (map.has(key)) sum += map.get(key)!;
    else absent++;
  }
  return `${sum} ${absent}`;
}

// has then add.
function addOnce(rounds: number): string {
  const numbers = new Set<number>();
  const objects = new Set<Point>();
  const strings = new Set<string>();
  let added = 0;
  for (let i = 0; i < rounds; i++) {
    const numberKey = half(i % 11);
    if (!numbers.has(numberKey)) {
      numbers.add(numberKey);
      added++;
    }
    const objectKey = points[i % 4];
    if (!objects.has(objectKey)) {
      objects.add(objectKey);
      added++;
    }
    const stringKey = "s" + (i % 3);
    if (!strings.has(stringKey)) {
      strings.add(stringKey);
      added++;
    }
  }
  return `${added} ${numbers.size} ${objects.size} ${strings.size}`;
}

// Negative cases: an insertion between the two operations. Every round adds keys, so the table is rebuilt again and again.
function insertNumbersBetween(rounds: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 5);
    const before = map.get(key);
    map.set(1000 + i, 1);
    map.set(key, (before ?? 0) + 1);
    if (map.has(key)) {
      map.set(-1000 - i, 1);
      map.set(key, map.get(key)! + 1);
    }
  }
  return map;
}

function insertPointsBetween(rounds: number): Map<Point, number> {
  const map = new Map<Point, number>();
  for (let i = 0; i < rounds; i++) {
    const key = points[i % 5];
    const before = map.get(key);
    map.set(new Point(1000 + i, 0), 1);
    map.set(key, (before ?? 0) + 1);
    if (map.has(key)) {
      map.set(new Point(-1000 - i, 0), 1);
      map.set(key, map.get(key)! + 1);
    }
  }
  return map;
}

function insertStringsBetween(rounds: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < rounds; i++) {
    const key = "k" + (i % 5);
    const before = map.get(key);
    map.set("first" + i, 1);
    map.set(key, (before ?? 0) + 1);
    if (map.has(key)) {
      map.set("second" + i, 1);
      map.set(key, map.get(key)! + 1);
    }
  }
  return map;
}

// The key itself is inserted, removed, or the table emptied, between the two operations.
function changeKeyBetween(rounds: number): string {
  const map = new Map<number, number>();
  const set = new Set<number>();
  let text = "";
  let differing = 0;
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 4);
    const hadBefore = map.has(key);
    map.set(key, i);
    const afterInsertion = map.get(key) === i;
    const hasBeforeDelete = map.has(key);
    map.delete(key);
    const afterDelete = map.get(key);
    map.set(key, i);
    map.set(key + 100, i);
    const hasBeforeClear = map.has(key);
    map.clear();
    const afterClear = map.get(key);
    map.set(key, (afterClear ?? 7) + 1);
    const wasMember = set.has(key);
    set.delete(key);
    set.add(key);
    const line = `${hadBefore} ${afterInsertion} ${hasBeforeDelete} ${afterDelete} ${hasBeforeClear} ${afterClear} ${map.get(key)} ${map.size} ${wasMember} ${set.has(key)}`;
    if (i < 8) text += line + "\n";
    else if (line !== "false true true undefined true undefined 8 1 true true") differing++;
  }
  return `${text}rounds that differ: ${differing}, ${set.size}`;
}

// The write is out of sight: in a function that is called, through another name for the same table, or in another table.
function callBetween(map: Map<number, number>, change: (map: Map<number, number>, round: number) => void, rounds: number): string {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 5);
    const before = map.get(key);
    change(map, i);
    map.set(key, (before ?? 0) + 1);
    if (map.has(key)) {
      change(map, -i - 1);
      sum += map.get(key) ?? -1;
    }
  }
  return `${sum} ${summarize(map, nameOfNumber)}`;
}

function aliasBetween(map: Map<number, number>, alias: Map<number, number>, rounds: number): string {
  for (let i = 0; i < rounds; i++) {
    const key = half(i % 5);
    const before = map.get(key);
    alias.set(2000 + i, 1);
    map.set(key, (before ?? 0) + 1);
  }
  return `${summarize(map, nameOfNumber)} | ${summarize(alias, nameOfNumber)}`;
}

const rounds = 300;
console.log(summarize(countNumbers(rounds), nameOfNumber));
console.log(summarize(countPoints(rounds), nameOfPoint));
console.log(summarize(countStrings(rounds), nameOfString));
console.log(sumPresentNumbers(countNumbers(rounds), rounds));
console.log(sumPresentPoints(countPoints(rounds), new Point(0, 0), rounds));
console.log(sumPresentStrings(countStrings(rounds), rounds));
console.log(addOnce(rounds));
console.log(summarize(insertNumbersBetween(rounds), nameOfNumber));
console.log(summarize(insertPointsBetween(rounds), nameOfPoint));
console.log(summarize(insertStringsBetween(rounds), nameOfString));
console.log(changeKeyBetween(rounds));
console.log(callBetween(new Map<number, number>(), (map, round) => { map.set(3000 + round, 1); }, rounds));
console.log(callBetween(new Map<number, number>(), (map, round) => { map.delete(half(Math.abs(round) % 5)); }, rounds));
console.log(callBetween(new Map<number, number>(), () => {}, rounds));
const shared = new Map<number, number>();
console.log(aliasBetween(shared, shared, rounds));
console.log(aliasBetween(new Map<number, number>(), new Map<number, number>(), rounds));

// The same outside loops.
const once = new Map<number, string>();
const onceKey: number = half(2);
console.log(once.has(onceKey), once.get(onceKey));
once.set(onceKey, (once.get(onceKey) ?? "none") + "!");
console.log(once.has(onceKey) ? once.get(onceKey) : "absent");
const found = once.get(onceKey);
once.set(2, "two").set(3, "three").set(4, "four").set(5, "five").set(6, "six");
once.set(onceKey, found + "?");
console.log(once.get(1), once.size);
const members = new Set<Point>();
console.log(members.has(points[0]), members.add(points[0]).has(points[0]), members.has(new Point(0, 0)), members.size);
