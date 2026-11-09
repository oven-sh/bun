// A loop over a Map or a Set whose body writes no collection and calls nothing reads the table once, in front of the loop, and steps it on what it read.
// Every shape of table must answer as plain Bun does: an empty one, one with deleted entries in front, one whose keys are not what the type says,
// one that the engine made outside compiled code (Map.groupBy, eval), one written as a literal, a huge one, nested loops, and a loop left by break.
// A loop whose turns let other code run (a yield, an await, a getter) steps the table as it is written, and sees what that code writes to it.
type Box = { score: number; terms: string[] };
const unseen = <T>(x: T): T => [x][JSON.parse("0")];

function fill(n: number): Map<number, Box> {
  const map = new Map<number, Box>();
  for (let i = 0; i < n; i++) map.set(i, { score: i * 0.5, terms: ["a", "b"] });
  return map;
}

function sumMap(map: Map<number, Box>): number {
  let sum = 0;
  for (const [id, box] of map) sum += box.score + id;
  return sum;
}

function sumKeys(map: Map<number, Box>): number {
  let sum = 0;
  for (const id of map.keys()) sum += id;
  return sum;
}

function sumValues(map: Map<number, Box>): number {
  let sum = 0;
  for (const box of map.values()) sum += box.score;
  return sum;
}

function sumSet(set: Set<number>): number {
  let sum = 0;
  for (const v of set) sum += v;
  return sum;
}

function firstAbove(set: Set<number>, bound: number): number {
  for (const v of set) {
    if (v > bound) return v;
  }
  return -1;
}

function joinKeys(map: Map<string, number>): string {
  let text = "";
  for (const [k, v] of map) text += k + "=" + v + ";";
  return text;
}

const map = fill(2000);
console.log("map", sumMap(map), sumKeys(map), sumValues(map));

const set = new Set<number>();
for (let i = 0; i < 2000; i++) set.add(i * 3);
console.log("set", sumSet(set), firstAbove(set, 100), firstAbove(set, 1e9));

console.log("empty", sumMap(new Map()), sumSet(new Set()), sumKeys(new Map()));

// Deleted entries in front of the walk and behind it, then loops that write nothing.
const thinned = fill(3000);
for (let i = 0; i < 1000; i++) thinned.delete(i);
for (let i = 2500; i < 3000; i += 2) thinned.delete(i);
console.log("thinned", sumMap(thinned), sumKeys(thinned), thinned.size);
for (let round = 0; round < 3; round++) console.log("thinned again", sumMap(thinned));
thinned.delete(1000);
console.log("thinned more", sumMap(thinned));

// The keys are not what the type says: strings where numbers are declared, and numbers among the strings.
const lying = new Map<string, number>();
(lying as Map<unknown, number>).set(1, 10);
lying.set("two", 20);
(lying as Map<unknown, number>).set(3.5, 30);
console.log("lying", joinKeys(lying), sumMap(unseen(lying) as unknown as Map<number, Box>) || 0);
const stringsAsNumbers = new Map<number, Box>();
(stringsAsNumbers as Map<unknown, Box>).set("a", { score: 1, terms: [] });
(stringsAsNumbers as Map<unknown, Box>).set("b", { score: 2, terms: [] });
let seen = "";
for (const [k, box] of stringsAsNumbers) seen += String(k) + ":" + box.score + " ";
console.log("strings as numbers", seen);

// Tables that the engine made outside compiled code.
const grouped = Map.groupBy([1, 2, 3, 4, 5, 6], (n: number) => n % 3) as Map<number, number[]>;
let groupedText = "";
for (const [rest, members] of grouped) groupedText += rest + "->" + members.join("+") + " ";
console.log("grouped", groupedText);
const evaluated = unseen(eval)("new Map([[1, 'one'], [2, 'two'], [3, 'three']])") as Map<number, string>;
let evaluatedText = "";
for (const [k, v] of evaluated) evaluatedText += k + v;
console.log("evaluated", evaluatedText);

// A literal, which the build may lay in the image.
const written = new Map<string, number>([
  ["a", 1],
  ["b", 2],
  ["c", 3],
]);
const writtenSet = new Set<string>(["x", "y", "z"]);
let literalText = "";
for (let round = 0; round < 2; round++) {
  for (const [k, v] of written) literalText += k + v;
  for (const s of writtenSet) literalText += s;
}
console.log("literal", literalText);

// Nested loops over two tables, and a loop over a table inside a loop that writes another table.
let nested = 0;
for (const s of set) {
  if (s > 30) break;
  for (const [id] of map) nested += id + s;
}
console.log("nested", nested);
const filled = new Set<number>();
for (const [id, box] of map) {
  if (box.score > 5) break;
  filled.add(id);
}
console.log("filled", filled.size, sumSet(filled));

// A huge table.
const huge = fill(unseen(70000));
console.log("huge", sumMap(huge), sumKeys(huge));

// A generator whose consumer deletes the key it was handed and adds enough keys to grow the table between two steps.
function* keysOf(map: Map<number, Box>): Generator<number> {
  for (const [key] of map) yield key;
}
const grown = fill(4);
let handed = "";
for (const key of keysOf(grown)) {
  handed += key + " ";
  grown.delete(key);
  if (key < 4) for (let i = 0; i < 40; i++) grown.set(100 * (key + 1) + i, { score: i, terms: [] });
}
console.log("generator", handed.length, grown.size, sumKeys(grown));

// An async loop whose await lets a microtask write the table.
async function sumWhileWritten(set: Set<number>): Promise<number> {
  let sum = 0;
  for (const v of set) {
    sum += v;
    await Promise.resolve().then(() => {
      set.delete(v);
      if (v < 100) set.add(v + 1000);
    });
  }
  return sum;
}
const awaited = new Set<number>([1, 2, 3, 4, 5]);
console.log("awaited", await sumWhileWritten(awaited), awaited.size, sumSet(awaited));

// A getter that clears the table under the loop.
class Clearing {
  constructor(private table: Map<number, Clearing>) {}
  get score(): number {
    this.table.clear();
    return 1;
  }
}
const clearing = new Map<number, Clearing>();
for (let i = 0; i < 5; i++) clearing.set(i, new Clearing(clearing));
let cleared = 0;
for (const [, value] of clearing) cleared += value.score;
console.log("clearing", cleared, clearing.size);
