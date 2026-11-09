// Each loop walks a Map or a Set of 2,000 entries `n` times and writes nothing to any collection: oven-sh/bun#48283. The table is read once in
// front of each walk, and every step reads only the entry. The Map is keyed by numbers and holds objects of one layout, as a search index does.
type Value = { score: number; terms: string[] };

function makeMap(count: number): Map<number, Value> {
  const map = new Map<number, Value>();
  for (let i = 0; i < count; i++) map.set(i, { score: i * 0.5, terms: ["a", "b"] });
  return map;
}

function iterMap(map: Map<number, Value>): number {
  let sum = 0;
  for (const [id, value] of map) sum += value.score + id;
  return sum;
}

function iterSet(set: Set<number>): number {
  let sum = 0;
  for (const v of set) sum += v;
  return sum;
}

function getMap(map: Map<number, Value>, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += map.get(i)!.score;
  return sum;
}

const count = 2000;
const map = makeMap(count);
const set = new Set<number>();
for (let i = 0; i < count; i++) set.add(i);

const loops: Record<string, (n: number) => number> = {
  "map-iter": n => {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += iterMap(map);
    return sum;
  },
  "set-iter": n => {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += iterSet(set);
    return sum;
  },
  "map-get": n => {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += getMap(map, count);
    return sum;
  },
};

const [loop, turns] = [process.argv[2], Number(process.argv[3])];
const run = loops[loop];
if (!run) throw new Error(`usage: main <${Object.keys(loops).join("|")}> <turns>`);
console.log(loop, run(turns));
