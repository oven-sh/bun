// A callee that returns its parameter, wraps it in what it returns, or hangs it into another parameter keeps nothing itself: what becomes of the value is decided by what the CALLER does with the answer or with the other operand, perhaps much later, perhaps in the caller's caller.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
type Read = () => string;
interface Box<T> {
  content: T;
}
function identity<T>(x: T): T {
  return x;
}
function firstOf<T>(a: T, b: T): T {
  return a;
}
function either<T>(a: T, b: T, first: boolean): T {
  return first ? a : b;
}
function wrap<T>(x: T): Box<T> {
  return { content: x };
}
function wrapTwice<T>(x: T): Box<Box<T>> {
  return wrap(wrap(x));
}
function pairUp<T>(a: T, b: T): [T, T] {
  return [a, b];
}
function thunk<T>(x: T): () => T {
  return () => x;
}
function attach<T>(box: Box<T | null>, x: T): void {
  box.content = x;
}
function attachAndReturn<T>(box: Box<T | null>, x: T): Box<T | null> {
  box.content = x;
  return box;
}
function through<T>(x: T): T {
  return identity(identity(identity(x)));
}
const keptReads: Read[] = [];
const keptBoxes: Box<unknown>[] = [];
const rare = (n: number) => n % 90 === 89;
// The caller keeps the answer on a rare path.
function caller(i: number): number {
  const state = { tag: "state" + i };
  const a = identity(() => "identity " + state.tag);
  const b = firstOf(() => "first " + state.tag, () => "never");
  const c = either(() => "left " + state.tag, () => "right " + state.tag, i % 2 === 0);
  const d = wrap(() => "wrapped " + state.tag);
  const e = wrapTwice(() => "wrapped twice " + state.tag);
  const f = pairUp(() => "pair 0 " + state.tag, () => "pair 1 " + state.tag);
  const g = thunk(() => "thunk " + state.tag);
  const h: Box<Read | null> = { content: null };
  attach(h, () => "attached " + state.tag);
  const j = attachAndReturn({ content: null } as Box<Read | null>, () => "attached and returned " + state.tag);
  const k = through(() => "through " + state.tag);
  if (rare(i)) {
    keptReads.push(a, b, c, f[1], g(), k);
    keptBoxes.push(d, e, h, j);
  }
  return a().length + b().length + c().length + d.content().length + e.content.content().length + f[0]().length + g()().length + h.content!().length + j.content!().length + k().length;
}
let sum = 0;
for (let i = 0; i < 270; i++) sum += caller(i);
console.log(sum, churn(80));
console.log(keptReads.map(f => f()).join(" | "));
function open(box: Box<unknown>): string {
  const inner = box.content;
  return typeof inner === "function" ? inner() : open(inner as Box<unknown>);
}
console.log(keptBoxes.map(open).join(" | "));

// The caller returns the answer, and ITS caller keeps it.
function middle(i: number): Read {
  const state = { tag: "middle" + i };
  return identity(() => state.tag);
}
function middleBox(i: number): Box<Read> {
  const state = { tag: "middle box" + i };
  return wrap(() => state.tag);
}
function top(i: number): number {
  const read = middle(i);
  const box = middleBox(i);
  if (rare(i)) keptReads.push(read, box.content);
  return read().length + box.content().length;
}
keptReads.length = 0;
for (let i = 0; i < 270; i++) sum += top(i);
console.log(sum, churn(80), keptReads.map(f => f()).join(" | "));

// The other operand is long-lived.
const longLived: Box<Read | null> = { content: null };
const shelf: Box<Read | null>[] = [];
function fills(i: number): void {
  const state = { tag: "filled" + i };
  attach(longLived, () => state.tag);
  const fresh: Box<Read | null> = { content: null };
  attach(fresh, () => "on the shelf " + state.tag);
  if (rare(i)) shelf.push(fresh);
}
for (let i = 0; i < 270; i++) fills(i);
console.log(churn(80), longLived.content!(), shelf.map(b => b.content!()).join(" | "));

// The answer is kept first and the value is made reachable afterwards.
const early: Box<Read | null>[] = [];
function keptThenFilled(i: number): void {
  const box: Box<Read | null> = { content: null };
  if (rare(i)) early.push(box);
  const state = { tag: "filled after it was kept " + i };
  attach(box, () => state.tag);
}
for (let i = 0; i < 270; i++) keptThenFilled(i);
console.log(churn(80), early.map(b => b.content!()).join(" | "));

// The answer is compared with what went in, and both are used.
let same = 0;
for (let i = 0; i < 200; i++) {
  const o = { n: i };
  const p = { n: -i };
  if (identity(o) === o) same++;
  if (either(o, p, i % 2 === 0) === (i % 2 === 0 ? o : p)) same++;
  if (wrap(o).content === o) same++;
  if (pairUp(o, p)[1] === p) same++;
  if (thunk(o)() === o) same++;
  if (wrap(o) !== wrap(o)) same++;
  identity(o).n++;
  wrap(o).content.n++;
  if (o.n === i + 2) same++;
}
console.log(same);
