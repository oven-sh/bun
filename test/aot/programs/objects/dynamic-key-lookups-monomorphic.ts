// Each way to ask a typed object about a key built at run time (`o[k]`, `Reflect.get`, `hasOwnProperty`, descriptors ..), one per loop, with garbage collections in between.
declare const console: { log(...values: unknown[]): void };
type Layout = { narrow: number; wide: number; tails: number; heads: number; masks: number; empty: number; space: number; words: number; tabs: number };
const make = (by: number): Layout => ({ narrow: by, wide: by + 1, tails: by + 2, heads: by + 3, masks: by + 4, empty: by + 5, space: by + 6, words: by + 7, tabs: by + 8 });
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
const texts = 'narrow wide tails heads masks empty space words tabs none1 none2 none3';
const key = (i: number): string => texts.split(' ')[i]!.split('').join('');
const record: any = make(100);
function count(name: string, isRight: (j: number) => boolean): void {
  let wrong = 0
  for (let round = 0; round < 100; round++) for (let i = 0; i < 12; i++) { const j = (i * 7 + round) % 12; if (!isRight(j)) wrong++; collect() }
  console.log(name, wrong)
}
const expected = (j: number): number | undefined => j < 9 ? 100 + j : undefined
count("indexed", j => record[key(j)] === expected(j))
count("Reflect.get", j => Reflect.get(record, key(j)) === expected(j))
count("descriptor", j => Object.getOwnPropertyDescriptor(record, key(j))?.value === expected(j))
count("hasOwnProperty.call", j => Object.prototype.hasOwnProperty.call(record, key(j)) === (j < 9))
count("Object.hasOwn", j => Object.hasOwn(record, key(j)) === (j < 9))
count("in", j => (key(j) in record) === (j < 9))
count("Reflect.has", j => Reflect.has(record, key(j)) === (j < 9))
count("propertyIsEnumerable", j => Object.prototype.propertyIsEnumerable.call(record, key(j)) === (j < 9))
export {};
