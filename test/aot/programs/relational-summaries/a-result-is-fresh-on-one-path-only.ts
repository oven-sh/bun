// A function that nearly always answers an object it has just made, and now and then one that somebody else holds: a cache, a shared default, a parameter, a field, the last answer. And one that always makes the object but also files it somewhere. The caller writes into the answer, so a shared one shows.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Size {
  w: number;
  h: number;
}
const shared: Size = { w: 0, h: 0 };
function freshOrShared(i: number): Size {
  return i % 50 === 49 ? shared : { w: i, h: i };
}
let cached: Size | null = null;
function freshThenCached(i: number): Size {
  if (cached !== null && i % 50 === 48) return cached;
  const made = { w: i, h: 1 };
  if (i % 50 === 47) cached = made;
  return made;
}
function freshOrParameter(given: Size, i: number): Size {
  if (i % 50 === 46) return given;
  return { w: given.w, h: given.h };
}
const holder = { size: { w: 7, h: 7 } as Size };
function freshOrField(i: number): Size {
  return i % 50 === 45 ? holder.size : { w: 7, h: 7 };
}
const registry: Size[] = [];
function freshButFiled(i: number): Size {
  const made = { w: i, h: 2 };
  if (i % 50 === 44) registry.push(made);
  return made;
}
let previous: Size = { w: -1, h: -1 };
function answersThePrevious(i: number): Size {
  const old = previous;
  previous = { w: i, h: 3 };
  return old;
}
function freshByOr(given: Size | null): Size {
  return given || { w: 1, h: 1 };
}
function freshByDefault(given: Size = { w: 2, h: 2 }): Size {
  return given;
}
function freshThroughACallee(i: number): Size {
  return freshOrShared(i);
}
function freshInTryOrCatch(i: number): Size {
  try {
    if (i % 50 === 43) throw shared;
    return { w: i, h: 4 };
  } catch (error) {
    return error as Size;
  }
}
const observers: (() => number)[] = [];
function freshButWatched(i: number): Size {
  const made = { w: i, h: 5 };
  if (i % 50 === 42) observers.push(() => made.w);
  return made;
}
let sum = 0;
const given: Size = { w: 100, h: 100 };
for (let i = 0; i < 200; i++) {
  for (const size of [
    freshOrShared(i),
    freshThenCached(i),
    freshOrParameter(given, i),
    freshOrField(i),
    freshButFiled(i),
    answersThePrevious(i),
    freshByOr(i % 50 === 41 ? given : null),
    i % 50 === 40 ? freshByDefault(given) : freshByDefault(),
    freshThroughACallee(i),
    freshInTryOrCatch(i),
    freshButWatched(i),
  ]) {
    size.w += 1000;
    sum += size.w + size.h;
  }
}
console.log(sum, churn(60));
console.log(shared.w, cached!.w, given.w, holder.size.w, registry.map(s => s.w).join(), previous.w, observers.map(f => f()).join());

// One call at a time, so that each answer could live in the caller's frame.
function area(i: number): number {
  const a = freshOrShared(i);
  a.h += 1;
  const b = freshOrShared(i);
  return (a === b ? 1_000_000 : 0) + a.h * 10 + b.h;
}
let areas = 0;
for (let i = 0; i < 200; i++) areas += area(i);
console.log(areas, shared.h);

// Classes: a constructor that hands out an instance made earlier, and a factory with a pool.
class Pooled {
  static pool: Pooled[] = [];
  uses = 0;
  constructor(public tag: string) {
    if (Pooled.pool.length > 0 && tag.endsWith("9")) return Pooled.pool[0];
    if (tag.endsWith("8")) Pooled.pool.push(this);
  }
}
let uses = "";
for (let i = 0; i < 60; i++) {
  const p = new Pooled("p" + i);
  p.uses++;
  if (i % 10 >= 8) uses += p.tag + ":" + p.uses + " ";
}
console.log(uses, churn(40), Pooled.pool.map(p => p.tag + ":" + p.uses).join());
