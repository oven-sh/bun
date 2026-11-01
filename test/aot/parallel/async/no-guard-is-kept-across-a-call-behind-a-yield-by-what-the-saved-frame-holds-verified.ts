// Flags: --aot-check=verify-each-stage --aot-heat=everything-is-hot
// No pass keeps a guard across a call behind a yield because a saved frame holds the object: once the frame lies in the heap the object is read out of it and comes from outside.
const marks: string[] = [];
class Failure extends Error {
  id: number;
  constructor(id: number) {
    super("failure " + id);
    this.id = id;
  }
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
type Steps = Generator<number, number, number | undefined>;
type SlowSteps = AsyncGenerator<number, number, number | undefined>;
function describe(value: unknown): string {
  if (value instanceof Failure) return "F" + value.id;
  if (value instanceof Error) return value.name + ": " + value.message;
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(describe).join() + "]" : "object";
  return Object.is(value, -0) ? "-0" : String(value);
}
function mark(...parts: unknown[]): void {
  marks.push(parts.map(describe).join(" "));
}
function flush(name: string): void {
  console.log(name + ": " + marks.join(" | "));
  marks.length = 0;
}
function step(name: string, run: () => IteratorResult<number, number>): void {
  try {
    const result = run();
    mark(name, result.done, result.value);
  } catch (error) {
    mark(name, "threw", error);
  }
}
async function slowStep(name: string, promise: Promise<IteratorResult<number, number>>): Promise<void> {
  try {
    const result = await promise;
    mark(name, result.done, result.value);
  } catch (error) {
    mark(name, "threw", error);
  }
}
function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
function later(value: number): Promise<number> {
  return new Promise(resolve => queueMicrotask(() => resolve(value)));
}
function resource(id: number): Disposable {
  mark("opened", id);
  return {
    [Symbol.dispose]() {
      mark("disposed", id);
    },
  };
}
let current: Steps | undefined;
function askAgain(): string {
  try {
    return describe(current?.next().value);
  } catch (error) {
    return describe(error);
  }
}
function closeAgain(): string {
  try {
    return describe(current?.return(-5).value);
  } catch (error) {
    return describe(error);
  }
}
function* plainInner(k: number): Steps {
  try {
    const got = yield k;
    yield k + (got ?? 1);
    return k + 2;
  } finally {
    mark("inner closed", k);
  }
}
function* yieldsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner closing", k);
    yield k + 100;
    mark("inner closed late", k);
  }
}
function* throwsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner throws", k);
    throw new Failure(k + 200);
  }
}
function* returnsInFinally(k: number): Steps {
  try {
    yield k;
    yield k + 1;
    return k + 2;
  } finally {
    mark("inner returns", k);
    return k + 300;
  }
}
function* catchesAndGoesOn(k: number): Steps {
  for (let i = 0; i < 4; i++) {
    try {
      yield k + i;
    } catch (error) {
      mark("inner caught", error);
    }
  }
  return k + 9;
}
function byHand(k: number, kind: number): Steps {
  let i = 0;
  const iterator: any = {
    [Symbol.iterator]() {
      return this;
    },
    next(value: unknown) {
      mark("hand next", k, value);
      return i < 3 ? { value: k + i++, done: false } : { value: k + 50, done: true };
    },
  };
  if (kind === 1) iterator.return = (value: unknown) => (mark("hand return", k, value), { value, done: true });
  if (kind === 2)
    iterator.return = () => {
      mark("hand return throws", k);
      throw new Failure(k + 400);
    };
  if (kind === 3) iterator.return = () => (mark("hand return answers a number", k), 5);
  if (kind === 4)
    Object.defineProperty(iterator, "return", {
      get() {
        mark("hand return read", k);
        return undefined;
      },
    });
  if (kind === 5) iterator.throw = (error: unknown) => (mark("hand throw", k, error), { value: k + 60, done: false });
  return iterator;
}
async function* slowInner(k: number): SlowSteps {
  try {
    yield k;
    await null;
    yield k + 1;
    return k + 2;
  } finally {
    mark("slow inner closing", k);
    await null;
    mark("slow inner closed", k);
  }
}
const home1 = {
*steps(start: number): Steps {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
for (const x of returnsInFinally(10)) {
n += x;
if (n % 3 === 2) continue;
if (n % 2 === 1) throw new Failure(1);
yield n + 2;
mark(2, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
}
mark(3, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
return n;
},
};
const steps1 = (start: number) => home1.steps(start);
function scene1(): void {
  const g = steps1(0);
  current = g;
  step("next", () => g.next());
  step("next", () => g.next(4));
  step("return", () => g.return(44));
  step("return", () => g.return(44));
  step("return", () => g.return(88));
  step("throw", () => g.throw(new Failure(-15)));
  step("next", () => g.next());
  step("next", () => g.next(6));
  current = undefined;
  flush("1");
}
class Home2 {
static *steps(start: number): Steps {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
try {
n += yield* yieldsInFinally(30);
mark(1, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
n += 3;
f += 0.25;
o.x += 1;
t += "c";
list.push(n);
} catch (error) {
mark(2, "caught", error);
o = new Point(n, o.x);
yield o.y;
mark(3, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
o.x += 1;
t += "c";
list.push(n);
} finally {
mark(6, got);
}
mark(8, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
return n;
}
}
const steps2 = (start: number) => Home2.steps(start);
function scene2(): void {
  let seen = 0;
  try {
  mark((steps2(9) as any).find((x: number) => ++seen > 0));
  } catch (error) {
    mark("threw", error);
  }
}
const steps3 = function* (start: number): Steps {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
for (const x of byHand(80, 1)) {
n += x;
if (n % 2 === 1) break;
try {
} catch (error) {
mark(3, "caught", error);
mark(5, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
}
}
try {
mark(7, got);
for (const x of returnsInFinally(30)) {
}
} finally {
mark(10, "finally");
try {
} finally {
mark(12, "finally");
}
yield n + 4;
mark(16, n, f, o.x, t, list.length, total(list));
}
mark(18, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
return n;
};
function scene3(): void {
  let seen = 0;
  try {
  mark((steps3(2) as any).drop(1).next().value);
  } catch (error) {
    mark("threw", error);
  }
}
const steps4 = async function* (start: number): SlowSteps {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
{
const [a1, b1] = plainInner(20);
mark(2, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
}
await null;
for (const x of byHand(80, 3)) {
}
mark(3, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
return n;
};
async function scene4(): Promise<void> {
  const g = steps4(5);
  flush("4");
}
function* steps5(start: number): Steps {
let n: number = start;
return n;
}
function scene5(): void {
  let seen = 0;
  try {
  for (const x of steps5(0)) mark("saw", x);
  } catch (error) {
    mark("threw", error);
  }
  mark("seen", seen);
  flush("5");
}
class Home6 {
static async *steps(start: number): SlowSteps {
try {
await null;
} catch (error) {
mark(1, "caught", error);
}
mark(3, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
return n;
}
}
const steps6 = (start: number) => Home6.steps(start);
async function scene6(): Promise<void> {
  let seen = 0;
  try {
  for await (const x of steps6(7)) mark("saw", x);
  } catch (error) {
    mark("threw", error);
  }
  mark("seen", seen);
  flush("6");
}
const steps7 = function* (start: number): Steps {
let n: number = start;
let f: number = 0.5;
let o = new Point(start, start + 1);
let t: string = "t";
const list: number[] = [start];
let got: number | undefined;
for (const x of catchesAndGoesOn(10)) {
using r2 = resource(2);
}
try {
got = yield 1;
mark(3, got);
} finally {
mark(4, "finally");
try {
} finally {
mark(6, "finally");
mark(7, got);
}
for (const x of returnsInFinally(90)) {
n += x;
}
try {
mark(9, n, f, o.x, t, list.length, list[0], list[list.length - 1]);
} catch (error) {
}
}
try {
} finally {
for (let i = 0; i < 3; i++) {
}
{
}
}
for (const x of returnsInFinally(10)) {
try {
} catch (error) {
}
}
return n;
};
function scene7(): void {
}
scene2();
