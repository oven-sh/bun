// The outer object has grown old. Then a young value is stored into the object that lies in it, or that object gets a cell of its own, and a young collection follows: nothing but the old object names the young one.
import { edenGC, fullGC } from "bun:jsc";

type Leaf = { id: number; text: string };
type Inner = { count: number; leaf: Leaf | null; other: Leaf | null; list: number[] | null };
type Outer = { inner: Inner; tag: number };

function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, leaf: null, other: null, list: null }, tag: i });
    }
  }
}

function churn(rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const some: Outer[] = [];
    fill(some, 6, 6);
    for (const each of some) each.inner.leaf = { id: round, text: "churn" + round };
    sum += some[round % 36].inner.leaf!.text.length;
  }
  return sum;
}

function storeYoung(outers: Outer[], round: number): void {
  for (let i = 0; i < outers.length; i++) {
    const outer = outers[i];
    outer.inner.leaf = { id: i + round, text: "leaf" + (i + round) };
    if (i % 2) outer.inner.list = [i, round];
  }
}

function storeThroughName(outers: Outer[], round: number): void {
  for (let i = 0; i < outers.length; i++) {
    const inner = outers[i].inner;
    inner.other = { id: i - round, text: "other" + (i - round) };
    inner.count += 1;
  }
}

function check(outers: Outer[], round: number, counted: number): number {
  let wrong = 0;
  for (let i = 0; i < outers.length; i++) {
    const inner = outers[i].inner;
    if (inner.leaf!.id !== i + round || inner.leaf!.text !== "leaf" + (i + round)) wrong++;
    if (inner.other!.id !== i - round || inner.other!.text !== "other" + (i - round)) wrong++;
    if (i % 2 && (inner.list![0] !== i || inner.list![1] !== round)) wrong++;
    if (inner.count !== i + counted) wrong++;
  }
  return wrong;
}

const seen = new Set<unknown>();
function isNew(value: unknown): boolean { const was = seen.has(value); seen.clear(); return !was; }
function wantsTheObject(outer: Outer): boolean { return isNew(outer.inner); }

const outers: Outer[] = [];
fill(outers, 20, 20);
fullGC();
fullGC();

let wrong = 0;
let total = 0;
for (let round = 1; round <= 6; round++) {
  storeYoung(outers, round);
  storeThroughName(outers, round);
  edenGC();
  total += churn(4);
  edenGC();
  wrong += check(outers, round, round);
}
console.log("stores into objects that lie in old ones:", wrong, total);

// Every third one gets its own cell now, which is young, and nobody keeps it.
let made = 0;
for (let i = 0; i < outers.length; i += 3) if (wantsTheObject(outers[i])) made++;
edenGC();
total += churn(6);
edenGC();
wrong += check(outers, 6, 6);
console.log("cells made for objects that lie in old ones:", made, wrong);

fullGC();
for (let round = 7; round <= 10; round++) {
  storeYoung(outers, round);
  storeThroughName(outers, round);
  edenGC();
  total += churn(4);
  edenGC();
  wrong += check(outers, round, round);
}
console.log("stores into both kinds:", wrong, total);

// The reverse: a young outer object is all that an old holder names.
const holders: { outer: Outer | null }[] = [];
for (let i = 0; i < 200; i++) holders.push({ outer: null });
fullGC();
for (let round = 0; round < 5; round++) {
  const fresh: Outer[] = [];
  fill(fresh, 10, 20);
  for (let i = 0; i < 200; i++) {
    fresh[i].inner.leaf = { id: i, text: "young" + round };
    holders[i].outer = fresh[i];
  }
  fresh.length = 0;
  edenGC();
  total += churn(3);
  edenGC();
  for (let i = 0; i < 200; i++) if (holders[i].outer!.inner.leaf!.text !== "young" + round || holders[i].outer!.inner.count !== i) wrong++;
}
console.log("young outer objects under old holders:", wrong, total);
