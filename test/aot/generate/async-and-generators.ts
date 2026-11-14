// The programs of async-and-generators that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "async-large-frames.ts": text(
      `// Async functions that keep many values alive across their awaits, so that their frames are large: every value is there again when the function goes on, after a real suspension, after an await that is settled already, and in a catch block.
let state = 12345;
function next(): number {
  state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
  return state % 1000;
}
interface Box {
  value: number;
  text: string;
}
function box(): Box {
  const value = next();
  return { value, text: "b" + value };
}
function text(): string {
  return "t" + next();
}
function later<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => setTimeout(() => resolve(value), 0));
}
function fails(reason: string): Promise<never> {
  return new Promise<never>((_, reject) => setTimeout(() => reject(new Error(reason)), 0));
}
function churn(): number {
  let kept = 0;
  for (let i = 0; i < 2000; i++) kept += [i, i + 1, { i }].length;
  return kept;
}
async function suspended(rounds: number): Promise<number> {`,
      [
        24,
        n => `  const n${3 * n} = next();
  const s${3 * n + 1} = text();
  const b${3 * n + 2} = box();`,
      ],
      `  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    sum += await later(round);
    sum += churn();
    sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
  }
  return sum;
}
async function settled(rounds: number): Promise<number> {`,
      [
        24,
        n => `  const n${3 * n} = next();
  const s${3 * n + 1} = text();
  const b${3 * n + 2} = box();`,
      ],
      `  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    sum += await round;
    sum += await Promise.resolve(round);
    sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
  }
  return sum;
}
async function caught(rounds: number): Promise<number> {`,
      [
        24,
        n => `  const n${3 * n} = next();
  const s${3 * n + 1} = text();
  const b${3 * n + 2} = box();`,
      ],
      `  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    try {
      sum += await fails("r" + round);
    } catch (error) {
      sum += (error as Error).message.length;
      sum += n0 * 1 + s1.length * 2 + s1.charCodeAt(1) + b2.value * 3 + b2.text.length + n3 * 4 + s4.length * 5 + s4.charCodeAt(1) + b5.value * 6 + b5.text.length + n6 * 7 + s7.length * 8 + s7.charCodeAt(1) + b8.value * 9 + b8.text.length + n9 * 10 + s10.length * 11 + s10.charCodeAt(1) + b11.value * 12 + b11.text.length + n12 * 13 + s13.length * 14 + s13.charCodeAt(1) + b14.value * 15 + b14.text.length + n15 * 16 + s16.length * 17 + s16.charCodeAt(1) + b17.value * 18 + b17.text.length + n18 * 19 + s19.length * 20 + s19.charCodeAt(1) + b20.value * 21 + b20.text.length + n21 * 22 + s22.length * 23 + s22.charCodeAt(1) + b23.value * 24 + b23.text.length + n24 * 25 + s25.length * 26 + s25.charCodeAt(1) + b26.value * 27 + b26.text.length + n27 * 28 + s28.length * 29 + s28.charCodeAt(1) + b29.value * 30 + b29.text.length + n30 * 31 + s31.length * 32 + s31.charCodeAt(1) + b32.value * 33 + b32.text.length + n33 * 34 + s34.length * 35 + s34.charCodeAt(1) + b35.value * 36 + b35.text.length + n36 * 37 + s37.length * 38 + s37.charCodeAt(1) + b38.value * 39 + b38.text.length + n39 * 40 + s40.length * 41 + s40.charCodeAt(1) + b41.value * 42 + b41.text.length + n42 * 43 + s43.length * 44 + s43.charCodeAt(1) + b44.value * 45 + b44.text.length + n45 * 46 + s46.length * 47 + s46.charCodeAt(1) + b47.value * 48 + b47.text.length + n48 * 49 + s49.length * 50 + s49.charCodeAt(1) + b50.value * 51 + b50.text.length + n51 * 52 + s52.length * 53 + s52.charCodeAt(1) + b53.value * 54 + b53.text.length + n54 * 55 + s55.length * 56 + s55.charCodeAt(1) + b56.value * 57 + b56.text.length + n57 * 58 + s58.length * 59 + s58.charCodeAt(1) + b59.value * 60 + b59.text.length + n60 * 61 + s61.length * 62 + s61.charCodeAt(1) + b62.value * 63 + b62.text.length + n63 * 64 + s64.length * 65 + s64.charCodeAt(1) + b65.value * 66 + b65.text.length + n66 * 67 + s67.length * 68 + s67.charCodeAt(1) + b68.value * 69 + b68.text.length + n69 * 70 + s70.length * 71 + s70.charCodeAt(1) + b71.value * 72 + b71.text.length;
    }
  }
  return sum;
}
async function few(rounds: number): Promise<number> {
  const a = next();
  const b = box();
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += (await later(round)) + a + b.value;
  return sum;
}
async function nested(depth: number): Promise<number> {
  if (depth === 0) return suspended(2);
  const before = box();
  const inner = await nested(depth - 1);
  return inner + before.value;
}
console.log(await suspended(3));
console.log(await settled(3));
console.log(await caught(3));
console.log(await few(3));
console.log(await nested(4));
console.log((await Promise.all([suspended(2), caught(2), settled(2), few(2), suspended(1)])).join());
`,
    ),
    "first-await-avoids-the-runtime.json": text(
      `{
  "env": {
    "JSC_aotCountsPath": "/dev/null"
  }
}
`,
    ),
    "first-await-avoids-the-runtime.ts": text(
      `// The first await of an activation saves its frame for the first time. The object that holds the frame is made without entering the runtime: for frames of a few words and of several hundred,
// whether a pending promise, a fulfilled one, a number or a call of another async function is awaited, and right after a collection. Numbers, fractions, strings and objects that only the
// suspended frame holds are there again when the function goes on. A frame too large for the small-object allocator, and an await of a thenable, may enter the runtime: they are not counted.
// The program counts the entries of the operations that a first await leaves for, which only the jsc shell can.
declare const aotOperationCount: undefined | ((name: string) => number);
declare const gc: undefined | (() => void);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
function entered(): number {
  return counted ? counted("operationAOTSaveFrameAndAwait") + counted("operationAOTSaveFrameAndAwaitCall") : 0;
}
// The runtime makes the first object of every block of the allocator, and a block holds fewer large frames than small ones: about four that keep 400 values, over a hundred that keep none.
function few(entries: number, calls: number, size: number): string {
  return entries * 1000 < calls * (90 + size) ? "few entries" : entries + " ENTRIES FOR " + calls + " CALLS";
}
const lines: string[] = [];
const fulfilled = Promise.resolve(5);
type Gate = number | Promise<number>;
type Keeps = (awaited: Gate) => Promise<number>;

let state = 12345;
function next(): number {
  state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
  return state % 1000;
}
interface Box {
  value: number;
  text: string;
}
function box(): Box {
  const value = next();
  return { value, text: "b" + value };
}
function text(): string {
  return "t" + next();
}
function mix(hash: number, value: number): number {
  return (hash * 31 + value) % 1000003;
}
async function waitsFor(awaited: Gate): Promise<number> {
  return (await awaited) + 1;
}
async function keeps0(awaited: Gate): Promise<number> {
  let h = await awaited;
  return h;
}
async function keeps1(awaited: Gate): Promise<number> {
  const n0 = next();
  let h = await awaited;
  h = mix(h, n0);
  return h;
}
async function keeps2(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8;
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8);
  return h;
}
async function keeps3(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length);
  return h;
}
async function keeps4(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  return h;
}
async function keeps6(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8;
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8);
  return h;
}
async function keeps8(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  return h;
}
async function keeps12(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  h = mix(h, n8); h = mix(h, d9 * 8); h = mix(h, s10.charCodeAt(1) + s10.length); h = mix(h, b11.value + b11.text.length);
  return h;
}
async function keeps16(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  h = mix(h, n8); h = mix(h, d9 * 8); h = mix(h, s10.charCodeAt(1) + s10.length); h = mix(h, b11.value + b11.text.length);
  h = mix(h, n12); h = mix(h, d13 * 8); h = mix(h, s14.charCodeAt(1) + s14.length); h = mix(h, b15.value + b15.text.length);
  return h;
}
async function keeps24(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  const n16 = next(), d17 = next() / 8, s18 = text(), b19 = box(), n20 = next(), d21 = next() / 8, s22 = text(), b23 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  h = mix(h, n8); h = mix(h, d9 * 8); h = mix(h, s10.charCodeAt(1) + s10.length); h = mix(h, b11.value + b11.text.length);
  h = mix(h, n12); h = mix(h, d13 * 8); h = mix(h, s14.charCodeAt(1) + s14.length); h = mix(h, b15.value + b15.text.length);
  h = mix(h, n16); h = mix(h, d17 * 8); h = mix(h, s18.charCodeAt(1) + s18.length); h = mix(h, b19.value + b19.text.length);
  h = mix(h, n20); h = mix(h, d21 * 8); h = mix(h, s22.charCodeAt(1) + s22.length); h = mix(h, b23.value + b23.text.length);
  return h;
}
async function keeps32(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  const n16 = next(), d17 = next() / 8, s18 = text(), b19 = box(), n20 = next(), d21 = next() / 8, s22 = text(), b23 = box();
  const n24 = next(), d25 = next() / 8, s26 = text(), b27 = box(), n28 = next(), d29 = next() / 8, s30 = text(), b31 = box();
  let h = await awaited;
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  h = mix(h, n8); h = mix(h, d9 * 8); h = mix(h, s10.charCodeAt(1) + s10.length); h = mix(h, b11.value + b11.text.length);
  h = mix(h, n12); h = mix(h, d13 * 8); h = mix(h, s14.charCodeAt(1) + s14.length); h = mix(h, b15.value + b15.text.length);
  h = mix(h, n16); h = mix(h, d17 * 8); h = mix(h, s18.charCodeAt(1) + s18.length); h = mix(h, b19.value + b19.text.length);
  h = mix(h, n20); h = mix(h, d21 * 8); h = mix(h, s22.charCodeAt(1) + s22.length); h = mix(h, b23.value + b23.text.length);
  h = mix(h, n24); h = mix(h, d25 * 8); h = mix(h, s26.charCodeAt(1) + s26.length); h = mix(h, b27.value + b27.text.length);
  h = mix(h, n28); h = mix(h, d29 * 8); h = mix(h, s30.charCodeAt(1) + s30.length); h = mix(h, b31.value + b31.text.length);
  return h;
}
async function keeps48(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  const n16 = next(), d17 = next() / 8, s18 = text(), b19 = box(), n20 = next(), d21 = next() / 8, s22 = text(), b23 = box();
  const n24 = next(), d25 = next() / 8, s26 = text(), b27 = box(), n28 = next(), d29 = next() / 8, s30 = text(), b31 = box();
  const n32 = next(), d33 = next() / 8, s34 = text(), b35 = box(), n36 = next(), d37 = next() / 8, s38 = text(), b39 = box();
  const n40 = next(), d41 = next() / 8, s42 = text(), b43 = box(), n44 = next(), d45 = next() / 8, s46 = text(), b47 = box();
  let h = await awaited;`,
      [
        12,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps64(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  const n16 = next(), d17 = next() / 8, s18 = text(), b19 = box(), n20 = next(), d21 = next() / 8, s22 = text(), b23 = box();
  const n24 = next(), d25 = next() / 8, s26 = text(), b27 = box(), n28 = next(), d29 = next() / 8, s30 = text(), b31 = box();
  const n32 = next(), d33 = next() / 8, s34 = text(), b35 = box(), n36 = next(), d37 = next() / 8, s38 = text(), b39 = box();
  const n40 = next(), d41 = next() / 8, s42 = text(), b43 = box(), n44 = next(), d45 = next() / 8, s46 = text(), b47 = box();
  const n48 = next(), d49 = next() / 8, s50 = text(), b51 = box(), n52 = next(), d53 = next() / 8, s54 = text(), b55 = box();
  const n56 = next(), d57 = next() / 8, s58 = text(), b59 = box(), n60 = next(), d61 = next() / 8, s62 = text(), b63 = box();
  let h = await awaited;`,
      [
        16,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps96(awaited: Gate): Promise<number> {`,
      [
        12,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        24,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps128(awaited: Gate): Promise<number> {`,
      [
        16,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        32,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps192(awaited: Gate): Promise<number> {`,
      [
        24,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        48,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps256(awaited: Gate): Promise<number> {`,
      [
        32,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        64,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps400(awaited: Gate): Promise<number> {`,
      [
        50,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        100,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function keeps1200(awaited: Gate): Promise<number> {`,
      [
        150,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await awaited;`,
      [
        300,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function calls0(awaited: Gate): Promise<number> {
  let h = await waitsFor(awaited);
  return h;
}
async function calls2(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8;
  let h = await waitsFor(awaited);
  h = mix(h, n0); h = mix(h, d1 * 8);
  return h;
}
async function calls8(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  let h = await waitsFor(awaited);
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  return h;
}
async function calls32(awaited: Gate): Promise<number> {
  const n0 = next(), d1 = next() / 8, s2 = text(), b3 = box(), n4 = next(), d5 = next() / 8, s6 = text(), b7 = box();
  const n8 = next(), d9 = next() / 8, s10 = text(), b11 = box(), n12 = next(), d13 = next() / 8, s14 = text(), b15 = box();
  const n16 = next(), d17 = next() / 8, s18 = text(), b19 = box(), n20 = next(), d21 = next() / 8, s22 = text(), b23 = box();
  const n24 = next(), d25 = next() / 8, s26 = text(), b27 = box(), n28 = next(), d29 = next() / 8, s30 = text(), b31 = box();
  let h = await waitsFor(awaited);
  h = mix(h, n0); h = mix(h, d1 * 8); h = mix(h, s2.charCodeAt(1) + s2.length); h = mix(h, b3.value + b3.text.length);
  h = mix(h, n4); h = mix(h, d5 * 8); h = mix(h, s6.charCodeAt(1) + s6.length); h = mix(h, b7.value + b7.text.length);
  h = mix(h, n8); h = mix(h, d9 * 8); h = mix(h, s10.charCodeAt(1) + s10.length); h = mix(h, b11.value + b11.text.length);
  h = mix(h, n12); h = mix(h, d13 * 8); h = mix(h, s14.charCodeAt(1) + s14.length); h = mix(h, b15.value + b15.text.length);
  h = mix(h, n16); h = mix(h, d17 * 8); h = mix(h, s18.charCodeAt(1) + s18.length); h = mix(h, b19.value + b19.text.length);
  h = mix(h, n20); h = mix(h, d21 * 8); h = mix(h, s22.charCodeAt(1) + s22.length); h = mix(h, b23.value + b23.text.length);
  h = mix(h, n24); h = mix(h, d25 * 8); h = mix(h, s26.charCodeAt(1) + s26.length); h = mix(h, b27.value + b27.text.length);
  h = mix(h, n28); h = mix(h, d29 * 8); h = mix(h, s30.charCodeAt(1) + s30.length); h = mix(h, b31.value + b31.text.length);
  return h;
}
async function calls128(awaited: Gate): Promise<number> {`,
      [
        16,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await waitsFor(awaited);`,
      [
        32,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
async function calls400(awaited: Gate): Promise<number> {`,
      [
        50,
        n =>
          `  const n${8 * n} = next(), d${8 * n + 1} = next() / 8, s${8 * n + 2} = text(), b${8 * n + 3} = box(), n${8 * n + 4} = next(), d${8 * n + 5} = next() / 8, s${8 * n + 6} = text(), b${8 * n + 7} = box();`,
      ],
      `  let h = await waitsFor(awaited);`,
      [
        100,
        n =>
          `  h = mix(h, n${4 * n}); h = mix(h, d${4 * n + 1} * 8); h = mix(h, s${4 * n + 2}.charCodeAt(1) + s${4 * n + 2}.length); h = mix(h, b${4 * n + 3}.value + b${4 * n + 3}.text.length);`,
      ],
      `  return h;
}
const keepers: [size: number, keeps: Keeps][] = [[0, keeps0], [1, keeps1], [2, keeps2], [3, keeps3], [4, keeps4], [6, keeps6], [8, keeps8], [12, keeps12], [16, keeps16], [24, keeps24], [32, keeps32], [48, keeps48], [64, keeps64], [96, keeps96], [128, keeps128], [192, keeps192], [256, keeps256], [400, keeps400], [1200, keeps1200]];
const callers: [size: number, keeps: Keeps][] = [[0, calls0], [2, calls2], [8, calls8], [32, calls32], [128, calls128], [400, calls400]];

let finished = 0;
class Holder {
  constructor(readonly base: number) {}
  async wait(awaited: Gate): Promise<number> {
    const kept = box();
    return (await awaited) + this.base + kept.value;
  }
  static async waitToo(awaited: Gate): Promise<number> {
    const kept = text();
    return (await awaited) + kept.length;
  }
}
const holder = new Holder(9);
const arrow: Keeps = async awaited => {
  const kept = text();
  return (await awaited) + kept.length;
};
function makes(offset: number, label: string): Keeps {
  return async awaited => (await awaited) + offset + label.length;
}
async function inATry(awaited: Gate): Promise<number> {
  const kept = box();
  try {
    return (await awaited) + kept.value;
  } finally {
    finished++;
  }
}
async function inALoop(awaited: Gate): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += await awaited;
  return sum;
}
async function onOneOfTwoRoads(awaited: Gate): Promise<number> {
  if (next() % 2) {
    const early = await awaited;
    return early + 1;
  }
  const kept = box();
  return (await awaited) + kept.value;
}
async function withARest(awaited: Gate, ...rest: number[]): Promise<number> {
  return (await awaited) + rest.length;
}
async function withADefault(awaited: Gate, more: number = next()): Promise<number> {
  return (await awaited) + more;
}
async function inAnOperand(awaited: Gate): Promise<number> {
  return next() + (await awaited) * next();
}
async function callsInATry(awaited: Gate): Promise<number> {
  const kept = box();
  try {
    return (await waitsFor(awaited)) + kept.value;
  } finally {
    finished++;
  }
}

const calls = 400;
async function measure(label: string, keeps: Keeps, size: number): Promise<void> {
  const results: string[] = [];
  for (const mode of ["pending promises", "a fulfilled promise", "numbers"] as const) {
    const opens: ((value: number) => void)[] = [];
    const all: Promise<number>[] = [];
    const before = entered();
    for (let i = 0; i < calls; i++) {
      if (mode === "pending promises") all.push(keeps(new Promise<number>(resolve => opens.push(resolve))));
      else all.push(keeps(mode === "numbers" ? i : fulfilled));
    }
    const entries = entered() - before;
    if (mode === "pending promises") collect();
    opens.forEach((open, i) => open(i));
    const hash = (await Promise.all(all)).reduce(mix, 0);
    results.push(mode + " " + hash + (size <= 400 ? ", " + few(entries, calls, size) : ""));
  }
  const thenable: any = {
    then(resolve: (value: number) => void): void {
      resolve(3);
    },
  };
  results.push("a thenable " + (await keeps(thenable)));
  lines.push(label + ": " + results.join("; "));
}
// A hundred activations at a time are suspended at their first await while the collector runs, and the next ones find the allocator as the collector left it.
async function withCollections(label: string, keeps: Keeps, size: number): Promise<void> {
  const rounds = 2000;
  const before = entered();
  let hash = 0;
  let suspended: Promise<number>[] = [];
  for (let i = 0; i < rounds; i++) {
    suspended.push(keeps(i % 3 ? i : fulfilled));
    if (i % 100 === 99) {
      collect();
      for (const value of await Promise.all(suspended)) hash = mix(hash, value);
      suspended = [];
    }
  }
  lines.push(label + ", with collections: " + hash + ", " + few(entered() - before, rounds, size));
}

for (const [size, keeps] of keepers) await measure("keeps " + size + " values", keeps, size);
for (const [size, keeps] of callers) await measure("keeps " + size + " values and awaits a call", keeps, size);
await measure("a method", awaited => holder.wait(awaited), 4);
await measure("a static method", awaited => Holder.waitToo(awaited), 4);
await measure("an arrow function", arrow, 4);
await measure("a closure", makes(4, "four"), 4);
await measure("in a try", inATry, 4);
await measure("in a loop", inALoop, 4);
await measure("on one of two roads", onOneOfTwoRoads, 4);
await measure("with a rest parameter", awaited => withARest(awaited, 1, 2, 3), 4);
await measure("with a default", withADefault, 4);
await measure("in an operand", inAnOperand, 4);
await measure("a call in a try", callsInATry, 4);
for (const [size, keeps] of keepers) if (size === 0 || size === 8 || size === 64 || size === 400) await withCollections("keeps " + size + " values", keeps, size);
for (const [size, keeps] of callers) if (size === 2 || size === 128) await withCollections("keeps " + size + " values and awaits a call", keeps, size);
lines.push("finally blocks run: " + finished);
console.log(lines.join("\\n"));

export {};
`,
    ),
  });
