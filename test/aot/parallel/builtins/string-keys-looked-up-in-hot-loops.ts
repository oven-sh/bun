// Map.get, Map.has and Set.has with string keys in loops that run often enough to be compiled for speed.
// Each case changes something that the loop may have read before it started: the table, its size, its kind, the key's cell.
const turns = 3000;
const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.map(value => JSON.stringify(value)).join(" "));
}

function sumOf(map: Map<string, number>, keys: string[]): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(keys[i % keys.length]!) ?? -1;
  return sum;
}
function countIn(set: Set<string>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < turns; i++) if (set.has(keys[i % keys.length]!)) count++;
  return count;
}
function countKeys(map: Map<string, unknown>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < turns; i++) if (map.has(keys[i % keys.length]!)) count++;
  return count;
}

const names = ["red", "green", "blue", "cyan", "pink", "gray", "gold", "teal", "plum", "lime"];

report("no table yet", sumOf(new Map(), names), countIn(new Set(), names), countKeys(new Map(), names));

const few = new Map<string, number>();
for (let i = 0; i < 5; i++) few.set(names[i]!, i);
report("five entries", sumOf(few, names), countKeys(few, names));

const eight = new Map<string, number>();
for (let i = 0; i < 8; i++) eight.set(names[i]!, i * 10);
report("eight entries", sumOf(eight, names));
eight.set(names[8]!, 80);
report("nine entries", sumOf(eight, names));

const written = new Map<string, number>([["red", 1], ["green", 2], ["blue", 3]]);
const writtenSet = new Set<string>(["red", "green", "blue"]);
report("made from a written list", sumOf(written, names), countIn(writtenSet, names), sumOf(written, names), countIn(writtenSet, names));

// The same text in another cell, with the same characters behind it or with others.
const joined = names.map(name => (name + "!").slice(0, -1));
const parsed: string[] = JSON.parse(JSON.stringify(names));
const ropes = names.map(name => name.slice(0, 2) + name.slice(2));
report("other cells", sumOf(few, joined), sumOf(few, parsed), sumOf(few, ropes), sumOf(written, parsed), countIn(writtenSet, ropes));

const wide = ["ключ", "鍵", "clé", "κλειδί"];
const wideMap = new Map<string, number>(wide.map((key, index): [string, number] => [key, index]));
report("characters of 16 bits", sumOf(wideMap, wide), sumOf(wideMap, JSON.parse(JSON.stringify(wide))), sumOf(wideMap, names));

const removed = new Map<string, number>(few);
removed.delete("green");
removed.delete("red");
report("deleted entries", sumOf(removed, names), countKeys(removed, names));
removed.set("red", 100);
report("added again", sumOf(removed, names));

// The table changes while the loop runs.
function growing(): number {
  const map = new Map<string, number>();
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i % 300 === 0) map.set(names[(i / 300) % names.length]!, i);
    sum += map.get(names[i % names.length]!) ?? 1;
  }
  return sum;
}
function shrinking(): number {
  const set = new Set<string>(names.slice(0, 8));
  let count = 0;
  for (let i = 0; i < turns; i++) {
    if (i % 400 === 399) set.delete(names[((i - 399) / 400) % 8]!);
    if (set.has(names[i % names.length]!)) count++;
  }
  return count;
}
function cleared(): number {
  const map = new Map<string, number>(few);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 1500) map.clear();
    if (i === 2000) map.set("blue", 7);
    sum += map.get(names[i % names.length]!) ?? 0;
  }
  return sum;
}
function writtenThenChanged(): number {
  const map = new Map<string, number>([["red", 1], ["green", 2]]);
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 1000) map.set("blue", 3);
    if (i === 2000) map.delete("red");
    sum += (map.get(names[i % 4]!) ?? 0) + map.size;
  }
  return sum;
}
report("changed in the loop", growing(), shrinking(), cleared(), writtenThenChanged());

// Another table each turn.
function alternating(): number {
  const maps = [few, eight, written, new Map<string, number>(), removed];
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += maps[i % maps.length]!.get(names[i % names.length]!) ?? -2;
  return sum;
}
report("another table each turn", alternating());

// Values of every kind.
type Held = { weight: number };
const held = new Map<string, Held | string | number | boolean | null | undefined>([
  ["red", { weight: 4 }], ["green", "text"], ["blue", 1.5], ["cyan", true], ["pink", null], ["gray", undefined], ["gold", 2 ** 40],
]);
function kindsOfValues(): string {
  const seen: Record<string, number> = {};
  for (let i = 0; i < turns; i++) {
    const value = held.get(names[i % names.length]!);
    const kind = value === null ? "null" : typeof value;
    seen[kind] = (seen[kind] ?? 0) + 1;
  }
  return JSON.stringify(seen);
}
report("values of every kind", kindsOfValues(), countKeys(held, names));

// Keys that are not all strings lie in the table.
const mixed = new Map<unknown, number>([["red", 1], [1, 2], [null, 3], [few, 4], ["blue", 5]]);
function stringsAmongOthers(): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += mixed.get(names[i % names.length]!) ?? 0;
  return sum;
}
report("strings among other keys", stringsAmongOthers());

// A key that may be undefined.
function maybeMissing(): number {
  const map = new Map<string | undefined, number>([["red", 1], [undefined, 50]]);
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(names[i % 12]) ?? 0;
  return sum;
}
report("a key that may be undefined", maybeMissing());

class Defaults extends Map<string, number> {
  getOr(key: string, fallback: number) {
    return this.get(key) ?? fallback;
  }
}
const defaults = new Defaults([["a", 1]]);
function belowMap(): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += defaults.getOr(i & 1 ? "a" : "b", 9);
  return sum;
}
report("a class below Map", belowMap());

console.log(lines.join("\n"));
