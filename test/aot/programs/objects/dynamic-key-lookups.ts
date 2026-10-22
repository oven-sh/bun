// Fields of a typed object are looked up with keys that are built at run time, with garbage collections in between.
declare const console: { log(...values: unknown[]): void };
type Layout = { narrow: number; wide: number; tails: number; heads: number; masks: number; empty: number; space: number; words: number; tabs: number };
function make(by: number): Layout {
  return { narrow: by, wide: by + 1, tails: by + 2, heads: by + 3, masks: by + 4, empty: by + 5, space: by + 6, words: by + 7, tabs: by + 8 };
}
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
const texts = 'narrow wide tails heads masks empty space words tabs none1 none2 none3';
// A new string each time: never one of the program's constants.
function key(i: number): string {
  return texts.split(' ')[i]!.split('').join('');
}
function expected(by: number, i: number): number | undefined {
  return i < 9 ? by + i : undefined;
}
const record: any = make(100);
let wrongIndexed = 0, wrongReflect = 0, wrongDescriptor = 0, wrongHas = 0, wrongIn = 0;
for (let round = 0; round < 60; round++) { // Five collections for each key: more rounds are too slow for the suite.
  for (let i = 0; i < 12; i++) {
    const j = (i * 7 + round) % 12;
    if (record[key(j)] !== expected(100, j)) wrongIndexed++;
    collect();
    if (Reflect.get(record, key(j)) !== expected(100, j)) wrongReflect++;
    collect();
    if (Object.getOwnPropertyDescriptor(record, key(j))?.value !== expected(100, j)) wrongDescriptor++;
    collect();
    if (Object.prototype.hasOwnProperty.call(record, key(j)) !== (j < 9)) wrongHas++;
    collect();
    if (key(j) in record !== (j < 9)) wrongIn++;
    collect();
  }
}
console.log('indexed', wrongIndexed, 'Reflect.get', wrongReflect, 'descriptor', wrongDescriptor, 'hasOwnProperty', wrongHas, 'in', wrongIn);
function count(name: string, rounds: number, isRight: (j: number) => boolean): void {
  let wrong = 0;
  for (let round = 0; round < rounds; round++) for (let i = 0; i < 12; i++) { const j = (i * 7 + round) % 12; if (!isRight(j)) wrong++; collect(); }
  console.log(name, wrong);
}
count('alone: indexed', 40, j => record[key(j)] === expected(100, j));
count('alone: Reflect.get', 40, j => Reflect.get(record, key(j)) === expected(100, j));
count('alone: descriptor', 40, j => Object.getOwnPropertyDescriptor(record, key(j))?.value === expected(100, j));
count('alone: hasOwnProperty.call', 40, j => Object.prototype.hasOwnProperty.call(record, key(j)) === (j < 9));
count('alone: Object.hasOwn', 40, j => Object.hasOwn(record, key(j)) === (j < 9));
count('alone: in', 40, j => (key(j) in record) === (j < 9));
count('alone: Reflect.has', 40, j => Reflect.has(record, key(j)) === (j < 9));
count('alone: propertyIsEnumerable', 40, j => Object.prototype.propertyIsEnumerable.call(record, key(j)) === (j < 9));
// ───── WRITES. The contents of the object afterwards are read BY THE PROGRAM's OWN NAMES, through the type, and compared with a model.
function read(l: Layout): (number | undefined)[] { return [l.narrow, l.wide, l.tails, l.heads, l.masks, l.empty, l.space, l.words, l.tabs]; }
// Separate names for the properties that are not fields here: `o.other1` keeps that name alive forever, and none1 .. none3 above have to die for the "has" tests to show anything.
function extras(o: any): unknown[] { return [o.other1, o.other2, o.other3]; }
const written = 'narrow wide tails heads masks empty space words tabs other1 other2 other3';
const keyWritten = (i: number): string => written.split(' ')[i]!.split('').join('');
function writes(name: string, rounds: number, write: (o: any, k: string, v: number) => void): void {
  let wrong = 0;
  for (let round = 0; round < rounds; round++) for (let i = 0; i < 12; i++) {
    const j = (i * 5 + round) % 12, v = 1000 + round * 12 + i, typed = make(0);
    write(typed, keyWritten(j), v);
    if ([...read(typed), ...extras(typed)].some((value, at) => value !== (at === j ? v : at < 9 ? at : undefined))) wrong++;
    collect();
  }
  console.log(name, wrong);
}
writes('store: indexed', 40, (o, k, v) => { o[k] = v; });
writes('store: Reflect.set', 40, (o, k, v) => { Reflect.set(o, k, v); });
writes('store: defineProperty', 40, (o, k, v) => { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); });
writes('store: Object.assign', 40, (o, k, v) => { Object.assign(o, { [k]: v }); });
// delete: the one that is named goes, and no other. What is left is read through the type: a test that asks by a name it keeps (`o.narrow` of an `any`, a list of the names, Object.keys(), JSON.stringify()) makes that name
// live for good, and shows nothing from then on.
type Loose = { narrow?: number; wide?: number; tails?: number; heads?: number; masks?: number; empty?: number; space?: number; words?: number; tabs?: number };
const makeLoose = (by: number): Loose => ({ narrow: by, wide: by + 1, tails: by + 2, heads: by + 3, masks: by + 4, empty: by + 5, space: by + 6, words: by + 7, tabs: by + 8 });
const readLoose = (l: Loose): (number | undefined)[] => [l.narrow, l.wide, l.tails, l.heads, l.masks, l.empty, l.space, l.words, l.tabs];
{
  let wrong = 0;
  for (let round = 0; round < 40; round++) for (let i = 0; i < 9; i++) {
    const j = (i * 5 + round) % 9, typed = makeLoose(10);
    delete (typed as any)[key(j)];
    if (readLoose(typed).some((value, at) => value !== (at === j ? undefined : 10 + at))) wrong++;
    collect();
  }
  console.log('delete', wrong);
}
// Not tested: a name that dies without a collection in between (native code's `Identifier::fromString(vm, "narrow")`). No program can create one: a string's name lives until its JSString is swept.
export {};
