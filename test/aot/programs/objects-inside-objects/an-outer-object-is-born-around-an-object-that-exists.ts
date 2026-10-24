// Most outer objects are born together with their inner object. Some are born around an object that exists already, in cells that held other pairs before.
import { edenGC, fullGC } from "bun:jsc";

type Inner = { count: number; label: string; list: number[]; other: object | null };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + i, list: [i, i + 1], other: { i } }, tag: i });
    }
  }
}
function around(inner: Inner, tag: number): Outer { return { inner, tag }; }

// The same with an inner object of one field, in an outer object with many of its own.
type Only = { ref: number[] };
type Wide = { only: Only; a: number; b: string; c: number; d: string; e: number };
function fillWide(into: Wide[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ only: { ref: [i, i * 2] }, a: i, b: "b" + i, c: -i, d: "d" + i, e: i / 2 });
    }
  }
}
function aroundOnly(only: Only, i: number): Wide { return { only, a: i, b: "b" + i, c: -i, d: "d" + i, e: i / 2 }; }
function showWide(wide: Wide): string { return `${wide.only.ref.join("+")} ${wide.a} ${wide.b} ${wide.c} ${wide.d} ${wide.e}`; }
function show(outer: Outer): string { return `${outer.tag}:${outer.inner.count} ${outer.inner.label} ${outer.inner.list.join("+")} ${JSON.stringify(outer.inner.other)}`; }

const given: Inner[] = [];
function give(outer: Outer): void { given.push(outer.inner); }
{
  const first: Outer[] = [];
  fill(first, 4, 4);
  give(first[1]); give(first[5]); give(first[9]);
}

const givenOnly: Only[] = [];
function giveOnly(wide: Wide): void { givenOnly.push(wide.only); }
{
  const first: Wide[] = [];
  fillWide(first, 4, 4);
  giveOnly(first[2]); giveOnly(first[6]);
}

const kept: Outer[] = [];
const keptWide: Wide[] = [];
let sum = 0;
for (let round = 0; round < 30; round++) {
  // Many pairs live and die, so that the free cells of their size are full of what they held.
  let some: Outer[] | null = [];
  fill(some, 16, 16);
  sum += some[round].inner.list[1];
  some = null;
  let wide: Wide[] | null = [];
  fillWide(wide, 16, 16);
  sum += wide[round].only.ref[1];
  wide = null;
  if (round % 2) fullGC(); else edenGC();
  for (let i = 0; i < 40; i++) kept.push(around(given[i % 3], round * 100 + i));
  for (let i = 0; i < 40; i++) keptWide.push(aroundOnly(givenOnly[i % 2], round * 100 + i));
  if (round % 3 === 0) fullGC(); else edenGC();
  if (kept.length > 400) { kept.splice(0, 200); keptWide.splice(0, 200); }
}
fullGC();
console.log(sum, kept.length, kept.every(outer => given.includes(outer.inner)));
console.log(show(kept[0]), "|", show(kept[kept.length - 1]));
console.log(keptWide.length, keptWide.every(wide => givenOnly.includes(wide.only)), showWide(keptWide[0]), "|", showWide(keptWide[keptWide.length - 1]));
kept[0].inner = { count: -1, label: "new", list: [], other: null };
edenGC();
console.log(show(kept[0]), "|", show(kept[3]), "|", given.map(inner => inner.count).join());
