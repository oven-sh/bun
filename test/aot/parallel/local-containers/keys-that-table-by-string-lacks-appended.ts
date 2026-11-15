// Map<string, ..>.set and Set<string>.add of a key that the table lacks. The stub has two ways to the free place: the search by text, which knows that the key is a string and the keys are narrow, and the search by bits for undefined and null, which the type admits too. Every size of index, every width of the values, keys of every internal representation, tables that a key of another kind has widened
interface Entry { id: number }
const opaque = <T>(value: T): T => Reflect.get({ value }, ["val", "ue"].join("")) as T;
const lines: string[] = [];

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return "{" + (value as Entry).id + "}";
  return typeof value + " " + String(value);
}
function digestOfMap(map: Map<string, unknown>): string {
  let sum = 0, position = 0, text = "";
  for (const [key, value] of map) {
    const line = describe(key) + "=" + describe(value);
    for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i) + position) | 0;
    if (position < 3 || position >= map.size - 3) text += " " + line;
    position++;
  }
  return map.size + " " + sum + text;
}
function digestOfSet(set: Set<string>): string {
  let sum = 0, position = 0, text = "";
  for (const key of set) {
    const line = describe(key);
    for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i) + position) | 0;
    if (position < 3 || position >= set.size - 3) text += " " + line;
    position++;
  }
  return set.size + " " + sum + text;
}

// A key of each representation: a constant, a rope, a substring, 16-bit text, text without a hash yet, one character, the empty string.
function keyOf(kind: number, i: number): string {
  switch (kind) {
    case 0: return "k" + i;
    case 1: return opaque("a long prefix that makes a rope of this key ") + opaque(String(i));
    case 2: return ("[[" + i + "]]").slice(1, -1);
    case 3: return "Ж" + i;
    case 4: return String.fromCharCode(97 + (i % 26)) + i.toString(36);
    default: return i === 0 ? "" : String.fromCharCode(33 + (i % 90)) + (i > 90 ? i : "");
  }
}
function valueOf(kind: number, i: number): unknown {
  switch (kind) {
    case 0: return { id: i };
    case 1: return i % 3 ? { id: i } : i % 2 ? undefined : null;
    case 2: return i % 2 === 0;
    case 3: return i;
    case 4: return i + 0.5;
    default: return i < 20 ? { id: i } : i;
  }
}

function fillMap(map: Map<string, unknown>, keyKind: number, valueKind: number, from: number, to: number): void {
  for (let i = from; i < to; i++) map.set(keyOf(keyKind, i), valueOf(valueKind, i));
}
function fillSet(set: Set<string>, keyKind: number, from: number, to: number): void {
  for (let i = from; i < to; i++) set.add(keyOf(keyKind, i));
}

// 3: tags. 40: short slots. 300: long slots. 70000: more entries than a short number holds.
for (const size of [3, 8, 9, 40, 254, 255, 300, 70000]) {
  for (let keyKind = 0; keyKind < 6; keyKind++) {
    if (size > 300 && keyKind !== 0 && keyKind !== 3) continue;
    for (let valueKind = 0; valueKind < 6; valueKind++) {
      if (size > 300 && valueKind !== 0 && valueKind !== 5) continue;
      const map = new Map<string, unknown>();
      fillMap(map, keyKind, valueKind, 0, size);
      fillMap(map, keyKind, (valueKind + 1) % 6, size >> 1, size + 2);
      lines.push("map " + size + " " + keyKind + " " + valueKind + ": " + digestOfMap(map));
    }
    const set = new Set<string>();
    fillSet(set, keyKind, 0, size);
    fillSet(set, keyKind, size >> 1, size + 2);
    lines.push("set " + size + " " + keyKind + ": " + digestOfSet(set));
  }
}

// undefined and null among the strings: first, in the middle, last, again, deleted and added again.
function withNothing(size: number, at: number): void {
  const map = new Map<string, unknown>();
  const set = new Set<string>();
  const nothing: string[] = opaque([undefined, null]) as unknown as string[];
  for (let i = 0; i < size; i++) {
    if (i === at) for (const key of nothing) { map.set(key, { id: -i }); set.add(key); }
    map.set("k" + i, { id: i });
    set.add("k" + i);
  }
  for (const key of nothing) { map.set(key, map.get(key) === undefined ? "new" : "again"); set.add(key); }
  lines.push("nothing " + size + " " + at + ": " + digestOfMap(map) + " | " + digestOfSet(set));
  for (const key of nothing) lines.push("  " + map.delete(key) + " " + set.delete(key) + " " + map.has(key) + " " + set.has(key));
  for (const key of nothing) { map.set(key, 1.5); set.add(key); }
  map.set("last", 2.5); set.add("last");
  lines.push("  " + digestOfMap(map) + " | " + digestOfSet(set));
}
for (const size of [0, 1, 7, 8, 30, 400]) for (const at of [0, size >> 1, size - 1, size]) withNothing(size, at);

// A key that is no string came in through `any`: the keys are wide from then on, and strings are still added and found.
function widened(size: number, odd: unknown): void {
  const map = new Map<string, unknown>();
  const set = new Set<string>();
  fillMap(map, 0, 0, 0, size); fillSet(set, 0, 0, size);
  (map as Map<any, unknown>).set(odd, "odd"); (set as Set<any>).add(odd);
  fillMap(map, 0, 0, size, size + 12); fillSet(set, 0, size, size + 12);
  fillMap(map, 2, 3, 0, 5); fillSet(set, 2, 0, 5);
  lines.push("widened " + size + " " + describe(odd) + ": " + digestOfMap(map) + " | " + digestOfSet(set) + " | " + (map as Map<any, unknown>).get(odd) + " " + (set as Set<any>).has(odd));
}
for (const size of [0, 5, 60, 300]) for (const odd of [7, 1.5, -0, NaN, 2 ** 40, 10n ** 30n, Symbol.iterator, true]) widened(size, opaque(odd));

// Deleted entries leave places that are not taken again until the table is written anew.
const churned = new Map<string, unknown>();
const churnedSet = new Set<string>();
for (let round = 0; round < 400; round++) {
  for (let i = 0; i < 7; i++) { churned.set("r" + round + "." + i, { id: i }); churnedSet.add("r" + round + "." + i); }
  for (let i = 0; i < 7; i++) if ((round + i) % 5) { churned.delete("r" + round + "." + i); churnedSet.delete("r" + round + "." + i); }
}
lines.push("churned: " + digestOfMap(churned) + " | " + digestOfSet(churnedSet));

let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (sum * 33 + line.charCodeAt(i)) | 0;
console.log(lines.length, sum);
for (let i = 0; i < lines.length; i += 17) console.log(lines[i]);
