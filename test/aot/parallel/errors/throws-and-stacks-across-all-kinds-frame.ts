// What is thrown passes, and a stack lists, frames of every kind in one walk: functions with few and with many live values, callbacks of built-ins,
// accessors, bound functions, calls with lists of arguments, constructors, generators, async functions.

function namesOn(error: unknown): string {
  const stack = String((error as Error).stack ?? "");
  const names: string[] = [];
  for (const line of stack.split("\n")) {
    const match = /\b(walk[A-Za-z0-9]+)\b/.exec(line);
    if (match) names.push(match[1]);
  }
  return names.join(" < ");
}

let depthToThrowAt = 0;

function walkLeaf(value: number): number {
  if (value === depthToThrowAt) throw new Error("leaf " + value);
  return value + 1;
}

function walkOneValue(value: number): number {
  const kept = value * 3;
  return walkLeaf(value) + kept;
}

function walkManyValues(a: number, b: number, c: number, d: number, e: number, f: number): number {
  const g = a + b, h = c + d, i = e + f, j = a * c, k = b * d, l = c * e, m = d * f, n = a - f, o = b - e, p = c - d;
  const first = walkOneValue(a);
  const second = walkOneValue(b + 100);
  return first + second + g + h + i + j + k + l + m + n + o + p;
}

function walkTenParameters(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number {
  return walkManyValues(a, b, c, d, e, f) + g + h + i + j;
}

function walkTailCall(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number {
  return walkTenParameters(j, i, h, g, f, e, d, c, b, a);
}

function walkCatches(value: number): string {
  const before = value * 7;
  let text = "";
  for (let round = 0; round < 3; round++) {
    const inLoop = round + before;
    try {
      depthToThrowAt = round === 1 ? value : -1;
      text += walkTenParameters(value, 2, 3, 4, 5, 6, 7, 8, 9, 10) + ";";
    } catch (error) {
      text += "caught " + (error as Error).message + " [" + namesOn(error) + "] " + inLoop + ";";
    } finally {
      text += "finally " + inLoop + ";";
    }
  }
  depthToThrowAt = -1;
  return text + before;
}

console.log(walkCatches(11));
depthToThrowAt = 10;
try {
  walkTailCall(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
} catch (error) {
  console.log("tail call:", (error as Error).message, namesOn(error).includes("walkLeaf < walkOneValue < walkManyValues < walkTenParameters"));
}
depthToThrowAt = -1;

function walkCallback(value: number): number {
  return walkManyValues(value, 1, 2, 3, 4, 5);
}

function walkThroughBuiltIns(): void {
  const list = [1, 2, 3, 4];
  const ways: [string, () => unknown][] = [
    ["map", () => list.map(walkCallback)],
    ["forEach", () => list.forEach(value => void walkCallback(value))],
    ["sort", () => [3, 1, 2].sort((left, right) => walkCallback(left + 1) - right)],
    ["reduce", () => list.reduce((sum, value) => sum + walkCallback(value), 0)],
    ["replace", () => "abc".replace(/b/, () => String(walkCallback(3)))],
    ["from", () => Array.from({ length: 4 }, (_, index) => walkCallback(index))],
    ["stringify", () => JSON.stringify({ toJSON: () => walkCallback(3) })],
    ["parse", () => JSON.parse("[3]", (_, value) => (typeof value === "number" ? walkCallback(value) : value))],
    ["apply", () => Reflect.apply(walkCallback, undefined, [3])],
    ["call", () => walkCallback.call(undefined, 3)],
    ["bind", () => walkTenParameters.bind(undefined, 3, 2, 3, 4, 5)(6, 7, 8, 9, 10)],
    ["spread", () => walkTenParameters(...([3, 2, 3, 4, 5, 6, 7, 8, 9, 10] as [number, number, number, number, number, number, number, number, number, number]))],
    ["getter", () => ({ get value() { return walkCallback(3); } }).value],
    ["setter", () => { ({ set value(given: number) { walkCallback(given); } }).value = 3; }],
    ["proxy", () => new Proxy({} as Record<string, number>, { get: () => walkCallback(3) }).anything],
    ["symbol", () => `${{ [Symbol.toPrimitive]: () => walkCallback(3) } as unknown as string}`],
    ["iterator", () => [...{ [Symbol.iterator]: () => ({ next: () => ({ done: false, value: walkCallback(3) }) }) }]],
  ];
  depthToThrowAt = 3;
  for (const [name, way] of ways) {
    const kept = name.length;
    try {
      way();
      console.log(name, "did not throw");
    } catch (error) {
      console.log(name, (error as Error).message, namesOn(error), kept);
    }
  }
  depthToThrowAt = -1;
}
walkThroughBuiltIns();

function WalkPlainConstructor(this: { sum: number }, a: number, b: number, c: number, d: number, e: number, f: number) {
  this.sum = walkManyValues(a, b, c, d, e, f);
}

class WalkBase {
  sum: number;
  constructor(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.sum = walkManyValues(a, b, c, d, e, f);
  }
}

class WalkDerived extends WalkBase {
  constructor(...values: [number, number, number, number, number, number]) {
    super(...values);
  }
}

function walkConstructs(): void {
  for (const throwsAt of [-1, 5]) {
    depthToThrowAt = throwsAt;
    for (const make of [
      () => new (WalkPlainConstructor as unknown as new (...values: number[]) => { sum: number })(5, 2, 3, 4, 5, 6).sum,
      () => new WalkBase(5, 2, 3, 4, 5, 6).sum,
      () => new WalkDerived(5, 2, 3, 4, 5, 6).sum,
      () => Reflect.construct(WalkDerived, [5, 2, 3, 4, 5, 6]).sum,
    ]) {
      try {
        console.log("constructed", make());
      } catch (error) {
        console.log("constructor threw", (error as Error).message, namesOn(error));
      }
    }
  }
  depthToThrowAt = -1;
}
walkConstructs();

function walkReadsNull(holder: { inner: { value: number } | null }, extra: number): number {
  return holder.inner!.value + extra;
}

function walkReadsNullWithFrame(holder: { inner: { value: number } | null }, extra: number): number {
  const before = walkLeaf(extra);
  return holder.inner!.value + before + walkLeaf(extra + 1);
}

for (const read of [walkReadsNull, walkReadsNullWithFrame]) {
  for (const holder of [{ inner: { value: 1 } }, { inner: null }]) {
    try {
      console.log("read", read(holder, 40));
    } catch (error) {
      console.log("read threw", (error as Error).constructor.name, namesOn(error));
    }
  }
}

let deepest = 0;
function walkRecursion(depth: number, a: number, b: number): number {
  deepest = depth;
  return walkRecursion(depth + 1, b, a + 1) + a;
}

function walkRecursionInCallback(depth: number): number {
  deepest = depth;
  return [depth].map(value => walkRecursionInCallback(value + 1))[0] + 1;
}

for (let round = 0; round < 3; round++) {
  for (const recurse of [() => walkRecursion(0, 1, 2), () => walkRecursionInCallback(0)]) {
    deepest = 0;
    try {
      recurse();
      console.log("no overflow");
    } catch (error) {
      console.log((error as Error).constructor.name, deepest > 500, namesOn(error).startsWith("walkRecursion"));
    }
  }
  console.log("after the overflow", walkCatches(round).length);
}

function* walkGenerator(count: number): Generator<number, number, number> {
  let sum = 0;
  for (let index = 0; index < count; index++) {
    try {
      sum += yield walkManyValues(index, 1, 2, 3, 4, 5);
    } catch (error) {
      sum += 1000;
      console.log("generator caught", (error as Error).message, namesOn(error));
    }
  }
  return sum;
}

function walkDrivesGenerator(): void {
  depthToThrowAt = 2;
  const generator = walkGenerator(4);
  let step = generator.next();
  while (!step.done) step = generator.next(step.value);
  console.log("generator returned", step.value);
  const thrownInto = walkGenerator(2);
  thrownInto.next();
  console.log("thrown into", thrownInto.throw(new Error("from outside")).value);
  depthToThrowAt = -1;
}
walkDrivesGenerator();

async function walkAsyncLeaf(value: number): Promise<number> {
  await null;
  return walkManyValues(value, 1, 2, 3, 4, 5);
}

async function walkAsyncMiddle(value: number): Promise<number> {
  const kept = value * 2;
  const first = await walkAsyncLeaf(value + 50);
  const second = await walkAsyncLeaf(value);
  return first + second + kept;
}

async function walkAsyncTop(): Promise<void> {
  for (const throwsAt of [-1, 6]) {
    depthToThrowAt = throwsAt;
    try {
      console.log("async", await walkAsyncMiddle(6));
    } catch (error) {
      console.log("async caught", (error as Error).message, namesOn(error).startsWith("walkLeaf < walkOneValue < walkManyValues < walkAsyncLeaf"));
    }
  }
  depthToThrowAt = 6;
  console.log("settled", (await Promise.allSettled([walkAsyncMiddle(6), walkAsyncMiddle(7)])).map(result => result.status).join());
  depthToThrowAt = -1;
}

function walkCaptures(): string {
  const holder: { stack?: string } = {};
  Error.captureStackTrace(holder, walkCaptures);
  return namesOn(holder);
}

function walkCallsCapture(value: number): string {
  const kept = value + 1;
  return walkCaptures() + " " + kept;
}

console.log("captured", [1].map(walkCallsCapture)[0]);

function walkRest(...values: number[]): number {
  return walkManyValues(values[0], values[1], values[2], values[3], values[4], values[5]) + values.length;
}

function walkArguments(): number {
  return walkRest.apply(undefined, arguments as unknown as number[]);
}

depthToThrowAt = 9;
try {
  (walkArguments as (...values: number[]) => number)(9, 2, 3, 4, 5, 6, 7, 8);
} catch (error) {
  console.log("rest", (error as Error).message, namesOn(error));
}
depthToThrowAt = -1;
console.log("rest", (walkArguments as (...values: number[]) => number)(9, 2, 3, 4, 5, 6, 7, 8));

await walkAsyncTop();
