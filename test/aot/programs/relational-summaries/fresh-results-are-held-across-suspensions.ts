// A fresh result may be built in the caller's storage, and a closure that is only called may lie in the caller's frame, as long as the caller has a frame. A generator or an async function gives its frame up at every yield and await and goes on later, on another stack, after others have run.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Vec {
  x: number;
  y: number;
  tag: string;
}
function make(x: number, tag: string): Vec {
  return { x, y: -x, tag };
}
function makePair(x: number): [Vec, Vec] {
  return [make(x, "left" + x), make(x + 1, "right" + x)];
}
function sum(v: Vec): number {
  return v.x + v.y + v.tag.length;
}
function apply<T>(f: () => T): T {
  return f();
}
function* generator(i: number): Generator<string, string, number> {
  const before = make(i, "before the yield " + i);
  const [left, right] = makePair(i);
  let local = i;
  const bump = () => ++local + before.x;
  const first = apply(bump);
  const sent = yield before.tag + "/" + first;
  const after = make(sent, "after the yield " + sent);
  yield [before.tag, left.tag, right.tag, after.tag, apply(bump), sum(before), sum(after)].join();
  return before.tag + "+" + after.tag + "+" + apply(bump);
}
async function asyncFunction(i: number): Promise<string> {
  const before = make(i, "before the await " + i);
  const [left, right] = makePair(i);
  let local = i;
  const bump = () => ++local + before.x;
  const first = apply(bump);
  await null;
  const between = make(i * 2, "between " + i);
  await new Promise(resolve => setTimeout(resolve, 0));
  return [before.tag, left.tag, right.tag, between.tag, first, apply(bump), sum(before), sum(between)].join();
}
async function* asyncGenerator(i: number): AsyncGenerator<string> {
  const held = make(i, "held by an async generator " + i);
  yield held.tag;
  await null;
  yield held.tag + " still " + sum(held);
}
async function inALoop(count: number): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = make(i, "round " + i);
    const read = () => v.tag;
    await null;
    out.push(apply(read) + sum(v));
  }
  return out.join();
}
async function inTryFinally(i: number): Promise<string> {
  const v = make(i, "tried " + i);
  try {
    await Promise.reject(new Error("rejected"));
    return "not reached";
  } catch (error) {
    const w = make(i + 1, "caught " + i);
    await null;
    return v.tag + "/" + w.tag + "/" + (error as Error).message;
  } finally {
    await null;
    v.x = -1;
  }
}
// Many at once, interleaved, so that each runs on what the others left behind.
const generators = Array.from({ length: 40 }, (_, i) => generator(i));
const firsts = generators.map(g => g.next().value);
churn(80);
const seconds = generators.map((g, i) => g.next(i * 100).value);
churn(80);
const thirds = generators.map(g => g.next(0).value);
console.log(firsts[39], "|", seconds[39], "|", thirds[39]);
console.log(firsts[0], "|", seconds[0], "|", thirds[0]);
const promises = Array.from({ length: 40 }, (_, i) => asyncFunction(i));
churn(80);
const answers = await Promise.all(promises);
console.log(answers[0], "|", answers[39]);
const streams = Array.from({ length: 10 }, (_, i) => asyncGenerator(i));
const heads = await Promise.all(streams.map(s => s.next()));
churn(80);
const tails = await Promise.all(streams.map(s => s.next()));
console.log(heads[9].value, "|", tails[9].value);
console.log((await Promise.all([inALoop(3), inALoop(4)])).join(" | "));
console.log((await Promise.all([inTryFinally(1), inTryFinally(2)])).join(" | "));

// A plain function whose closure outlives it only through a coroutine that it starts.
function starts(i: number): Promise<string> {
  const v = make(i, "started " + i);
  const read = () => v.tag + sum(v);
  return (async () => {
    await null;
    return apply(read);
  })();
}
const startedAll = Array.from({ length: 30 }, (_, i) => starts(i));
churn(80);
console.log((await Promise.all(startedAll))[29]);

// A generator that is dropped half way, returned early, or thrown into.
function* withCleanup(i: number, log: string[]): Generator<number> {
  const v = make(i, "cleanup " + i);
  try {
    yield 1;
    yield 2;
  } finally {
    log.push(v.tag + sum(v));
  }
}
const log: string[] = [];
const early = withCleanup(1, log);
early.next();
churn(40);
early.return(0);
const thrownInto = withCleanup(2, log);
thrownInto.next();
churn(40);
try {
  thrownInto.throw(new Error("thrown in"));
} catch (error) {
  log.push((error as Error).message);
}
for (const n of withCleanup(3, log)) if (n === 1) break;
console.log(log.join(" | "));
