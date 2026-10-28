function setOf(values: unknown): Set<unknown> {
  return new Set(values as Iterable<unknown>);
}
function mapOf(entries: unknown): Map<unknown, unknown> {
  return new Map(entries as Iterable<[unknown, unknown]>);
}
function optionalSetOf(values?: string[] | null): Set<string> {
  return new Set(values);
}
function optionalMapOf(entries?: [string, number][] | null): Map<string, number> {
  return new Map(entries);
}
function show(collection: Set<unknown> | Map<unknown, unknown>): string {
  return `${collection.size}:${JSON.stringify([...collection])}`;
}
function* counted(): Generator<number> {
  yield 1;
  yield 2;
  yield 1;
}

const holes = [1, , 3];
const sources: unknown[] = [
  undefined, null, [], ["http:", "https:", "mailto:", "tel:"], ["a", "a", "b"], [1, 1.5, NaN, NaN, 0, -0], holes, "hello", new Set([1, 2]), new Map([[1, 2]]).keys(), counted(),
  new Uint8Array([7, 7, 8]), { [Symbol.iterator]: () => [4, 5][Symbol.iterator]() },
];
for (const source of sources) console.log(show(setOf(source)));
console.log(show(optionalSetOf()), show(optionalSetOf(null)), show(optionalSetOf(["x", "y", "x"])));

const pairSources: unknown[] = [
  undefined, null, [], [["a", 1], ["b", 2], ["a", 3]], [[1, "one"], [NaN, "nan"], [NaN, "again"]], new Map([["k", "v"]]), Object.entries({ p: 1, q: 2 }), [[{}, 1]], [["only"]],
];
for (const source of pairSources) console.log(show(mapOf(source)));
console.log(show(optionalMapOf()), show(optionalMapOf(null)), show(optionalMapOf([["x", 1], ["x", 2]])));

for (const wrong of [1, true, {}, Symbol("s"), () => 1]) {
  for (const make of [setOf, mapOf]) {
    try {
      console.log(show(make(wrong)));
    } catch (error) {
      console.log((error as Error).name);
    }
  }
}
for (const wrong of [[1], ["ab"], [null], [undefined]]) {
  try {
    console.log(show(mapOf(wrong)));
  } catch (error) {
    console.log((error as Error).name);
  }
}
