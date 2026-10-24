// `list.slice()` and `list.slice(from, to)` whose result gets named properties at once, as a parser's node lists do, beside copies that get none. The stub that makes room for the properties and the stub that makes none leave for the run time when their allocator is empty, which is so behind every collection. Every copy has its elements and its properties, whichever way it was made
interface Item { id: number }
interface List extends Array<Item> { pos?: number; end?: number; hasTrailingComma?: boolean; flags?: number }
const lines: string[] = [];
function copyWithProperties(list: Item[], pos: number): List {
  const copy: List = list.slice();
  copy.pos = pos; copy.end = pos + list.length; copy.hasTrailingComma = (pos & 1) === 1; copy.flags = pos * 3;
  return copy;
}
function partWithProperties(list: Item[], from: number, to: number): List {
  const part: List = list.slice(from, to);
  part.pos = from; part.end = to; part.hasTrailingComma = false; part.flags = from ^ to;
  return part;
}
function plainCopy(list: Item[]): Item[] { return list.slice(); }
function plainPart(list: Item[], from: number, to: number): Item[] { return list.slice(from, to); }
function sumOf(list: List): number {
  let sum = list.length;
  for (let i = 0; i < list.length; i++) sum = (sum * 31 + list[i].id) | 0;
  return (sum * 31 + (list.pos ?? -1) * 7 + (list.end ?? -1) * 5 + (list.hasTrailingComma ? 3 : 0) + (list.flags ?? -1)) | 0;
}
const sources: Item[][] = [];
for (let length = 0; length < 24; length++) { const list: Item[] = []; for (let i = 0; i < length; i++) list.push({ id: length * 100 + i }); sources.push(list); }
const numbers = [1, 2, 3, 4, 5], fractions = [0.5, 1.5, 2.5];
let total = 0;
const kept: List[] = [];
for (let round = 0; round < 60; round++) {
  // Each order of the four makers behind a collection: whoever comes first finds both allocators empty.
  if (round % 2 === 0) Bun.gc(true);
  for (const list of sources) {
    const order = round % 4;
    for (let step = 0; step < 4; step++) {
      switch ((step + order) % 4) {
        case 0: { const copy = copyWithProperties(list, round); total = (total + sumOf(copy)) | 0; if (round % 7 === 0) kept.push(copy); break; }
        case 1: total = (total + sumOf(plainCopy(list))) | 0; break;
        case 2: { const part = partWithProperties(list, 1, -1); total = (total + sumOf(part)) | 0; if (round % 11 === 0) kept.push(part); break; }
        default: total = (total + sumOf(plainPart(list, -3, 100))) | 0;
      }
    }
  }
  const copied: number[] & { pos?: number } = numbers.slice(); copied.pos = round;
  const halves: number[] & { pos?: number } = fractions.slice(1); halves.pos = round;
  total = (total + copied.length + copied[4] + copied.pos + halves[0] * 2 + halves.pos) | 0;
}
lines.push("total " + total);
let keptSum = 0;
for (const list of kept) keptSum = (keptSum * 17 + sumOf(list)) | 0;
lines.push("kept " + kept.length + " " + keptSum);
const last = kept[kept.length - 1];
lines.push(Object.keys(last).join() + " " + JSON.stringify(last) + " " + Array.isArray(last) + " " + last.pos + " " + last.end);
last.push({ id: 1 }); (last as any).more = "more"; delete last.pos;
lines.push(Object.keys(last).join() + " " + last.length);
console.log(lines.join("\n"));
