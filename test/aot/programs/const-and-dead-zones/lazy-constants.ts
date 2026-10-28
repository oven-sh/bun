// A top-level const whose initializer only creates something is created at its first read: every kind of read finds the same object, and a read ahead of the declaration throws a ReferenceError.
interface Options { name: string; depth: number; tags: string[] }
type Handler = (value: number) => number;

function early(): string {
  try {
    return defaults.name;
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}
function earlyTable(): string {
  try {
    return String(handlers.length);
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}
console.log(early());
console.log(earlyTable());

const defaults: Options = { name: "defaults", depth: 3, tags: ["a", "b"] };
const handlers: Handler[] = [value => value + 1, value => value * 2, value => value - defaults.depth];
const byName = new Map<string, Options>();
const double: Handler = value => value * 2;
const nested = { inner: { deepest: { answer: 42 } }, list: [1, 2, 3] };
const text = `made of ${"parts"}`;
const pattern = /a+b/;
class Counter {
  count = 0;
  next(): number {
    return ++this.count + nested.inner.deepest.answer;
  }
}
const counter = new Counter();

function first(): string {
  return defaults.name + defaults.depth + defaults.tags.join();
}
function twice(): number {
  return defaults.depth + defaults.depth;
}
function inALoop(times: number): number {
  let sum = 0;
  for (let i = 0; i < times; i++) sum += handlers[i % handlers.length](i) + nested.list[i % 3];
  return sum;
}
function inAClosure(): () => number {
  return () => double(nested.inner.deepest.answer) + defaults.depth;
}
function onOneArm(flag: boolean): number {
  if (flag) return nested.inner.deepest.answer;
  return nested.list.length + nested.inner.deepest.answer;
}
function stores(): number {
  byName.set(defaults.name, defaults);
  byName.set("other", { name: "other", depth: 9, tags: [] });
  return byName.size + byName.get("other")!.depth;
}
function identity(): boolean {
  return defaults === defaults && byName.get("defaults") === defaults && handlers === handlers;
}
async function behindAnAwait(): Promise<string> {
  const before = defaults.name;
  await null;
  return before + text + pattern.test("caab") + counter.next() + counter.next();
}
function* inAGenerator(): Generator<number> {
  yield nested.list[0];
  yield defaults.depth;
  yield nested.list[2];
}

const firstReadInALeaf = { list: [4, 5, 6] };
const firstReadBetweenOthers = { inner: { deepest: 7 } };
const firstReadInATry = { held: "in a try" };
const firstReadInALoop = { step: 2 };
const firstReadInAnArrow = ["x", "y"];
const firstReadByTwo = { shared: 11 };
function leaf(): number[] {
  return firstReadInALeaf.list;
}
function betweenOthers(a: number, b: number, c: string, d: number[], e: number, f: number): string {
  const before = a * 2.5 + b;
  const length = d.length;
  const found = firstReadBetweenOthers.inner;
  return c + before + found.deepest + length + a + b + e / f;
}
function inATry(): string {
  try {
    return firstReadInATry.held;
  } catch {
    return "caught";
  }
}
function loops(times: number): number {
  let sum = 0.5;
  for (let i = 0; i < times; i++) sum += firstReadInALoop.step * i;
  return sum;
}
function byTwo(flag: boolean): number {
  return flag ? firstReadByTwo.shared + 1 : firstReadByTwo.shared + 2;
}
console.log(leaf().join(), leaf() === leaf(), betweenOthers(1.5, 2, "c", [1, 2, 3], 9, 4), betweenOthers(1.5, 2, "c", [1, 2, 3], 9, 4));
console.log(inATry(), inATry(), loops(0), loops(4), loops(4), [1, 2].map(i => firstReadInAnArrow[i - 1]).join(), byTwo(false), byTwo(true));
console.log(early(), earlyTable());
console.log(first(), twice(), inALoop(10), inAClosure()(), onOneArm(true), onOneArm(false));
console.log(stores(), identity(), [...inAGenerator()].join());
defaults.depth = 5;
console.log(first(), twice(), inALoop(4), inAClosure()());
behindAnAwait().then(said => console.log(said));
