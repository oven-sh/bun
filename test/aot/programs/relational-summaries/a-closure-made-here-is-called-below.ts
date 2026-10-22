// `function f(k, v) { run(() => { k.held = v; }); }`: f hands nothing but a closure to run, and run does nothing but call it. What becomes of k and v is written in the body of the closure: it links them, keeps them, returns them, throws them, stores them into what it is handed. The callee may be one call away or five, or a built-in.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Value {
  tag: string;
}
interface Keeper {
  held: Value | null;
}
function run<T>(body: () => T): T {
  return body();
}
function runDeeper<T>(body: () => T): T {
  return run(() => run(body));
}
function runFive<T>(body: () => T): T {
  return run5(body);
}
const run5 = <T,>(b: () => T): T => run4(b);
const run4 = <T,>(b: () => T): T => run3(b);
const run3 = <T,>(b: () => T): T => run2(b);
const run2 = <T,>(b: () => T): T => run(b);
function runWith<T>(body: (slot: Keeper) => void): Keeper {
  const slot: Keeper = { held: null };
  body(slot);
  return slot;
}
function runIgnoringTheAnswer(body: () => unknown): void {
  body();
}
function runTwice(body: () => void): void {
  body();
  body();
}
function runInTry(body: () => void): unknown {
  try {
    body();
    return null;
  } catch (error) {
    return error;
  }
}
const kept: Value[] = [];
const rare = (v: Value) => v.tag.endsWith("9");

function links(k: Keeper, v: Value): void {
  run(() => {
    k.held = v;
  });
}
function linksDeeper(k: Keeper, v: Value): void {
  runDeeper(() => {
    k.held = v;
  });
}
function linksFiveDown(k: Keeper, v: Value): void {
  runFive(() => {
    k.held = v;
  });
}
function linksInABuiltIn(k: Keeper, v: Value): void {
  [0].forEach(() => {
    k.held = v;
  });
}
function linksInASort(k: Keeper, v: Value): void {
  [2, 1].sort((a, b) => {
    k.held = v;
    return a - b;
  });
}
function linksInAReplace(k: Keeper, v: Value): void {
  "x".replace("x", () => {
    k.held = v;
    return "";
  });
}
function keeps(v: Value): void {
  run(() => {
    if (rare(v)) kept.push(v);
  });
}
function keepsFiveDown(v: Value): void {
  runFive(() => {
    if (rare(v)) kept.push(v);
  });
}
function keepsThoughTheAnswerIsIgnored(v: Value): void {
  runIgnoringTheAnswer(() => (rare(v) ? kept.push(v) : 0));
}
function returns(v: Value): Value {
  return run(() => v);
}
function returnsFiveDown(v: Value): Value {
  return runFive(() => v);
}
function returnsWrapped(v: Value): { inner: Value } {
  return run(() => ({ inner: v }));
}
function storesIntoWhatItIsHanded(v: Value): Keeper {
  return runWith(slot => {
    slot.held = v;
  });
}
function storesIntoAVariable(v: Value): Value | null {
  let last: Value | null = null;
  run(() => {
    last = v;
  });
  return last;
}
function throws(v: Value): unknown {
  return runInTry(() => {
    throw v;
  });
}
function makesAnotherClosure(v: Value): () => Value {
  return run(() => () => v);
}
function alternates(k: Keeper, a: Value, b: Value): void {
  let first = true;
  runTwice(() => {
    k.held = first ? a : b;
    first = false;
  });
}
class Owner {
  held: Value | null = null;
  take(v: Value): void {
    run(() => {
      this.held = v;
    });
  }
  takeInABuiltIn(v: Value): void {
    [0].forEach(() => {
      this.held = v;
    });
  }
}
const keepers: Keeper[] = Array.from({ length: 7 }, () => ({ held: null }));
const owners = [new Owner(), new Owner()];
const answers: unknown[] = [];
let same = 0;
for (let i = 0; i < 300; i++) {
  const v = (how: string): Value => ({ tag: how + " " + i });
  links(keepers[0], v("linked"));
  linksDeeper(keepers[1], v("linked deeper"));
  linksFiveDown(keepers[2], v("linked five down"));
  linksInABuiltIn(keepers[3], v("linked in forEach"));
  linksInASort(keepers[4], v("linked in sort"));
  linksInAReplace(keepers[5], v("linked in replace"));
  alternates(keepers[6], v("first"), v("second"));
  keeps(v("kept"));
  keepsFiveDown(v("kept five down"));
  keepsThoughTheAnswerIsIgnored(v("kept, answer ignored"));
  owners[0].take(v("taken"));
  owners[1].takeInABuiltIn(v("taken in forEach"));
  const mine = v("mine");
  if (returns(mine) === mine && returnsFiveDown(mine) === mine && returnsWrapped(mine).inner === mine && storesIntoWhatItIsHanded(mine).held === mine && storesIntoAVariable(mine) === mine && throws(mine) === mine && makesAnotherClosure(mine)() === mine) same++;
  if (i % 100 === 99) answers.push(returns(v("returned")), returnsFiveDown(v("returned five down")), returnsWrapped(v("wrapped")).inner, storesIntoWhatItIsHanded(v("in the slot")).held, storesIntoAVariable(v("in the variable")), throws(v("thrown")), makesAnotherClosure(v("in another closure"))());
  if (i % 100 === 50) churn(30);
}
console.log(same, churn(80));
console.log(keepers.map(k => k.held!.tag).join(" | "), "|", owners.map(o => o.held!.tag).join(" | "));
console.log(kept.filter(k => k.tag.endsWith("99")).map(k => k.tag).join(" | "), kept.length);
console.log(answers.map(a => (a as Value).tag).join(" | "));

// The closure keeps itself, or hands itself out, while it is "only called".
const selves: (() => string)[] = [];
function keepsItself(i: number): string {
  const state = { tag: "state " + i };
  return run(function me(): string {
    if (i % 100 === 99) selves.push(me);
    return state.tag;
  });
}
function answersItself(i: number): () => unknown {
  const state = { tag: "answering state " + i };
  const f = run(function me(): unknown {
    return i < 0 ? state : me;
  });
  return f as () => unknown;
}
let text = "";
const handedOut: (() => unknown)[] = [];
for (let i = 0; i < 300; i++) {
  text = keepsItself(i);
  const f = answersItself(i);
  if (i % 100 === 99) handedOut.push(f);
}
console.log(text, churn(80), selves.map(f => f()).join(" | "), handedOut.every(f => f() === f));
