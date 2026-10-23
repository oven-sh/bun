// `(first ? a : b).x = v` runs on every path and stores into one of the two. Whoever writes down "a.x is v when the call is over" for both has promised an object where a number stays. Every function here stores, deletes, freezes or appends through a name that stands for one of several objects; the callers read the other one.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Payload {
  n: number;
  tag: string;
}
interface Box {
  x: number | Payload;
  tag: string;
}
const weigh = (x: number | Payload | undefined): number => (typeof x === "number" ? x + 1 : x === undefined ? -1000 : x.n * 1000);
const shared: Box = { x: 7, tag: "shared" };

function intoOneOfTwo(a: Box, b: Box, first: boolean, v: Payload): void {
  const o = first ? a : b;
  o.x = v;
}
function intoOneOrTheShared(a: Box, own: boolean, v: Payload): void {
  (own ? a : shared).x = v;
}
function intoOneOrTheFallback(a: Box | undefined, fallback: Box, v: Payload): void {
  const o = a ?? fallback;
  o.x = v;
}
function intoTheLastThatFits(list: Box[], a: Box, v: Payload): void {
  let o = a;
  for (const item of list) if (item.tag === "fits") o = item;
  o.x = v;
}
function intoOneOfThree(a: Box, b: Box, c: Box, which: number, v: Payload): void {
  let o: Box;
  switch (which) {
    case 0:
      o = a;
      break;
    case 1:
      o = b;
      break;
    default:
      o = c;
  }
  o.x = v;
}
function readBackOutOfOwn(first: boolean, v: Payload): number | Payload {
  const p: Box = { x: 3, tag: "p" };
  const q: Box = { x: 4, tag: "q" };
  (first ? p : q).x = v;
  return p.x;
}
function returnsTheFirstOfOwn(first: boolean, v: Payload): Box {
  const p: Box = { x: 3, tag: "p" };
  const q: Box = { x: 4, tag: "q" };
  const o = first ? p : q;
  o.x = v;
  return p;
}
function returnsBothOfOwn(first: boolean, v: Payload): [Box, Box] {
  const p: Box = { x: 3, tag: "p" };
  const q: Box = { x: 4, tag: "q" };
  const o = first ? p : q;
  o.x = v;
  return [p, q];
}
function ownOrParameter(a: Box, own: boolean, v: Payload): Box {
  const p: Box = { x: 5, tag: "own" };
  (own ? p : a).x = v;
  return p;
}
function deletesFromOneOfTwo(a: Partial<Box>, b: Partial<Box>, first: boolean): void {
  delete (first ? a : b).x;
}
function freezesOneOfTwo(a: Box, b: Box, first: boolean): void {
  Object.freeze(first ? a : b);
}
function appendsToOneOfTwo(a: Payload[], b: Payload[], first: boolean, v: Payload): void {
  (first ? a : b).push(v);
}
function elementOfOneOfTwo(a: (number | Payload)[], b: (number | Payload)[], first: boolean, v: Payload): void {
  (first ? a : b)[0] = v;
}
class Holder {
  x: number | Payload = 9;
  intoThisOrTheOther(other: Holder, self: boolean, v: Payload): void {
    (self ? this : other).x = v;
  }
}
function twoStoresThatCross(a: Box, b: Box, first: boolean, v: Payload): void {
  const o = first ? a : b;
  const other = first ? b : a;
  o.x = v;
  other.x = 11;
}

let total = 0;
const seen: string[] = [];
for (let i = 0; i < 600; i++) {
  const first = i % 3 !== 0;
  const v: Payload = { n: i, tag: "v" + i };
  const a: Box = { x: 1, tag: "a" };
  const b: Box = { x: 2, tag: "b" };
  intoOneOfTwo(a, b, first, v);
  total += weigh(a.x) + weigh(b.x);
  const c: Box = { x: 1, tag: "c" };
  intoOneOrTheShared(c, first, v);
  total += weigh(c.x) + weigh(shared.x);
  shared.x = 7;
  const d: Box = { x: 1, tag: "d" };
  const fallback: Box = { x: 2, tag: "fallback" };
  intoOneOrTheFallback(first ? d : undefined, fallback, v);
  total += weigh(d.x) + weigh(fallback.x);
  const e: Box = { x: 1, tag: "e" };
  const inList: Box = { x: 2, tag: first ? "fits" : "does not" };
  intoTheLastThatFits([inList], e, v);
  total += weigh(e.x) + weigh(inList.x);
  const t0: Box = { x: 1, tag: "t0" };
  const t1: Box = { x: 2, tag: "t1" };
  const t2: Box = { x: 3, tag: "t2" };
  intoOneOfThree(t0, t1, t2, i % 3, v);
  total += weigh(t0.x) + weigh(t1.x) + weigh(t2.x);
  total += weigh(readBackOutOfOwn(first, v));
  total += weigh(returnsTheFirstOfOwn(first, v).x);
  const [p, q] = returnsBothOfOwn(first, v);
  total += weigh(p.x) + weigh(q.x);
  const f: Box = { x: 1, tag: "f" };
  total += weigh(ownOrParameter(f, first, v).x) + weigh(f.x);
  const g: Partial<Box> = { x: 1, tag: "g" };
  const h: Partial<Box> = { x: 2, tag: "h" };
  deletesFromOneOfTwo(g, h, first);
  total += weigh(g.x) + weigh(h.x);
  const j: Box = { x: 1, tag: "j" };
  const k: Box = { x: 2, tag: "k" };
  freezesOneOfTwo(j, k, first);
  try {
    j.x = 20;
  } catch {
    total += 5;
  }
  try {
    k.x = 30;
  } catch {
    total += 6;
  }
  total += weigh(j.x) + weigh(k.x);
  const l: Payload[] = [];
  const m: Payload[] = [];
  appendsToOneOfTwo(l, m, first, v);
  total += l.length * 10 + m.length;
  const n: (number | Payload)[] = [1];
  const o: (number | Payload)[] = [2];
  elementOfOneOfTwo(n, o, first, v);
  total += weigh(n[0]) + weigh(o[0]);
  const r = new Holder();
  const s = new Holder();
  r.intoThisOrTheOther(s, first, v);
  total += weigh(r.x) + weigh(s.x);
  const u: Box = { x: 1, tag: "u" };
  const w: Box = { x: 2, tag: "w" };
  twoStoresThatCross(u, w, first, v);
  total += weigh(u.x) + weigh(w.x);
  if (i % 199 === 198) {
    churn(30);
    seen.push([a.x, b.x, c.x, d.x, e.x, t0.x, t1.x, t2.x, p.x, q.x, f.x, g.x, h.x, n[0], o[0], r.x, s.x, u.x, w.x].map(x => (typeof x === "object" ? x.tag : String(x))).join());
  }
}
console.log(total, churn(60));
console.log(seen.join("\n"));
