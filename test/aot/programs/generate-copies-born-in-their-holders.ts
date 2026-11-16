// The programs of copies-born-in-their-holders: `bun test/aot/generate.ts copies-born-in-their-holders <where>` writes them.
import type { WrittenProgram } from "../generate";

const written: WrittenProgram[] = [];

type RecordKind = { type: string; literal: string; other: string };
type Source = { needs: (name: string, record: RecordKind) => string; next: string };
type Holder = { before?: string; type: string; make: string; inners: string };

const records: { [name: string]: RecordKind } = {
  numbers: { type: "{ a: number; b: number; c: number; flag: boolean }", literal: "{ a: 1, b: 2, c: 3, flag: false }", other: "{ flag: true, c: 30, b: 20, a: 10 }" },
  references: { type: "{ a: number; text: string; list: number[]; flag: boolean; more: { deep: number } }", literal: '{ a: 1, text: "one", list: [1, 2], flag: false, more: { deep: 1 } }', other: '{ more: { deep: 9 }, flag: true, list: [9], text: "nine", a: 10 }' },
  reals: { type: "{ a: number; half: number; big: number; flag: boolean }", literal: "{ a: 1, half: 0.5, big: 4294967296, flag: true }", other: "{ big: -0, half: NaN, flag: false, a: 10 }" },
  optional: { type: "{ a: number; maybe?: number; text?: string; flag: boolean }", literal: "{ a: 1, flag: false }", other: '{ a: 10, maybe: 5, text: "t", flag: true }' },
};

const sources: { [name: string]: Source } = {
  constantOfAnotherModule: { needs: () => `import { constant } from "./constants";`, next: "constant" },
  frozenConstant: { needs: (record, r) => `const frozen: Inner = Object.freeze(${r.literal});`, next: "frozen" },
  theCopyBefore: { needs: () => "", next: "current" },
  literalsOfTwoOrders: { needs: (record, r) => `const orders: Inner[] = [${r.literal}, ${r.other}];`, next: "orders[round % 2]" },
  withAnAddedName: { needs: (record, r) => `const added: Inner = ${r.literal};\n(added as any).extra = "extra";`, next: "added" },
  withAnIndex: { needs: (record, r) => `const indexed: Inner = ${r.literal};\n(indexed as any)[0] = "zero";`, next: "indexed" },
  parsed: { needs: (record, r) => `const parsed: Inner = JSON.parse(JSON.stringify(${r.other === records.reals.other ? r.literal : r.other}));`, next: "parsed" },
  withAGetter: { needs: (record, r) => `const computed: Inner = ${r.literal};\nObject.defineProperty(computed, "a", { get() { return 7; }, enumerable: true, configurable: true });`, next: "computed" },
  underAnotherPrototype: { needs: (record, r) => `const under: Inner = Object.setPrototypeOf(${r.literal}, { inherited: 1 });`, next: "under" },
};

const holders: { [name: string]: Holder } = {
  literal: {
    type: "{ inner: Inner; note: string }",
    make: `  if (round % 7 === 6) return { inner: source, note };\n  return { inner: { ...source, a: source.a + 1 }, note };`,
    inners: "[holder.inner]",
  },
  twoCopies: {
    type: "{ first: Inner; second: Inner; note: string }",
    make: `  return { first: { ...source, a: source.a + 1 }, second: { ...source, flag: !source.flag }, note };`,
    inners: "[holder.first, holder.second]",
  },
  nested: {
    type: "{ outer: { inner: Inner; count: number }; note: string }",
    make: `  return { outer: { inner: { ...source, a: source.a + 1 }, count: round }, note };`,
    inners: "[holder.outer.inner]",
  },
  instance: {
    before: `class Holder {\n  inner: Inner;\n  note: string;\n  constructor(source: Inner, note: string) {\n    this.inner = { ...source, a: source.a + 1 };\n    this.note = note;\n  }\n}`,
    type: "Holder",
    make: `  return new Holder(source, note);`,
    inners: "[holder.inner]",
  },
  plainCopy: {
    type: "{ inner: Inner; note: string; count: number }",
    make: `  return { inner: { ...source }, note, count: round };`,
    inners: "[holder.inner]",
  },
  copyLast: {
    type: "{ note: string; count: number; inner: Inner }",
    make: `  return { note, count: round, inner: { ...source, a: source.a + 1, flag: round % 2 === 0 } };`,
    inners: "[holder.inner]",
  },
  holderIsACopyToo: {
    before: `const base = { note: "base", count: 0 };`,
    type: "{ note: string; count: number; inner: Inner }",
    make: `  return { ...base, note, inner: { ...source, a: source.a + 1 } };`,
    inners: "[holder.inner]",
  },
};

const spelled = (name: string) => name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase());

for (const [record, r] of Object.entries(records))
  for (const [sourceName, source] of Object.entries(sources))
    for (const [holderName, holder] of Object.entries(holders)) {
      const text = `${source.needs(record, r)}
type Inner = ${r.type};
${holder.before ?? ""}
type Kept = ${holder.type};
function make(source: Inner, note: string, round: number): Kept {
${holder.make}
}
function show(value: unknown): string {
  return JSON.stringify(value, (key, each) => (typeof each === "number" && !Number.isFinite(each) ? String(each) : Object.is(each, -0) ? "-0" : each));
}
let current: Inner = ${r.literal};
const holdersKept: Kept[] = [];
const innersKept: Inner[] = [];
const bystanders: { before: number; text: string }[] = [];
let digest = 0;
function mix(text: string): void {
  for (let index = 0; index < text.length; index++) digest = (Math.imul(digest, 31) + text.charCodeAt(index)) | 0;
}
for (let round = 0; round < 400; round++) {
  bystanders.push({ before: round, text: "b" + round });
  const holder = make(${source.next}, "note " + round, round);
  const inners: Inner[] = ${holder.inners};
  current = inners[0];
  if (round % 3 === 0) holdersKept.push(holder);
  if (round % 5 === 0) innersKept.push(inners[inners.length - 1]);
  try {
    if (round % 11 === 0) inners[0].a += 100;
    if (round % 13 === 0) (inners[0] as any).late = round;
    if (round % 17 === 0) Object.freeze(holder);
    if (round % 19 === 0) delete (inners[0] as any).flag;
  } catch (error) {
    mix((error as Error).name + round);
  }
  if (round % 101 === 0) Bun.gc(true);
  if (current.a > 1000) current = ${r.literal};
  mix(show(holder));
}
Bun.gc(true);
console.log(digest);
mix(show(holdersKept));
console.log(digest);
mix(show(innersKept));
console.log(digest);
console.log(bystanders.filter((each, index) => each.before !== index || each.text !== "b" + index).length, show(current));
console.log(show(holdersKept[holdersKept.length - 1]), Object.keys(innersKept[3]).join());
`;
      const name = `${record}-${spelled(sourceName)}-${spelled(holderName)}`;
      if (sourceName === "constantOfAnotherModule")
        written.push({ entry: `${name}/main.ts`, files: { [`${name}/main.ts`]: text, [`${name}/constants.ts`]: `export const constant: ${r.type} = ${r.literal};\n` } });
      else written.push({ entry: `${name}.ts`, files: { [`${name}.ts`]: text } });
    }

export const programs = (): WrittenProgram[] => written;
