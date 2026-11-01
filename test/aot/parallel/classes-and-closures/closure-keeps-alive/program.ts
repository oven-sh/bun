declare function gc(): void;

interface Body { bytes: number[] }

let watched: WeakRef<Body>[] = [];
let kept: unknown[] = [];
let total = 0;

function body(): Body {
  const made: Body = { bytes: new Array<number>(32).fill(1) };
  watched.push(new WeakRef(made));
  return made;
}
function once(f: () => number): void {
  total += f();
}
function turn(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

class Emitter {
  listeners: (() => void)[] = [];
  on(listener: () => void): void {
    this.listeners.push(listener);
  }
  emit(): void {
    for (const listener of this.listeners) listener();
  }
}
const emitter = new Emitter();
let release: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

function nothingStored(i: number) {
  const request = body();
  const id = i;
  once(() => request.bytes.length);
  return () => id;
}
function aCounterBeside(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  return () => ++count;
}
function moreThanFourVariables(i: number) {
  const request = body();
  const a = i, b = i + 1, c = i + 2, d = i + 3;
  once(() => request.bytes.length + a);
  return () => a + b + c + d;
}
function bothStoredTo(i: number) {
  let request = body();
  let count = i;
  once(() => {
    const length = request.bytes.length;
    request = body();
    return length;
  });
  return () => ++count;
}
function storedToBeforeTheClosures(i: number) {
  let request: Body | undefined;
  if (i >= 0) request = body();
  let label = "n";
  label += i;
  once(() => request!.bytes.length);
  return () => label;
}
function storedToByAHelper(i: number) {
  let request: Body | undefined;
  let count = i;
  function load() {
    request = body();
  }
  load();
  total += request!.bytes.length;
  return () => ++count;
}
function aTimer(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  setTimeout(() => {
    total += ++count;
  }, 40);
  return undefined;
}
function aListener(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  emitter.on(() => {
    total += ++count;
  });
  return undefined;
}
function inALoop(i: number) {
  const made: (() => number)[] = [];
  for (let k = 0; k < 2; k++) {
    const request = body();
    let count = i + k;
    once(() => request.bytes.length);
    made.push(() => ++count);
  }
  return made;
}
function inABlock(i: number) {
  let count = i;
  {
    let request = body();
    once(() => {
      const length = request.bytes.length;
      request = body();
      return length;
    });
  }
  return () => ++count;
}
function aClosureInAClosure(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  return () => () => ++count;
}
function aParameter(i: number, request: Body = body()) {
  let count = i;
  once(() => request.bytes.length);
  return () => ++count;
}
function aCaughtError(i: number) {
  let count = i;
  try {
    throw body();
  } catch (request) {
    once(() => (request as Body).bytes.length);
    count++;
  }
  return () => ++count;
}
function threeSets(i: number) {
  let first = body(), second = body(), count = i;
  once(() => {
    first = first;
    return first.bytes.length;
  });
  once(() => {
    second = second;
    return second.bytes.length + ++count;
  });
  return () => ++count;
}
async function acrossAnAwait(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  const bump = () => ++count;
  kept.push(bump);
  await gate;
  return bump();
}
async function madeAfterAnAwait(i: number) {
  const request = body();
  once(() => request.bytes.length);
  await undefined;
  let count = i;
  const bump = () => ++count;
  kept.push(bump);
  await gate;
  return bump();
}
async function helpersAcrossAnAwait(i: number) {
  let request: Body | undefined;
  let count = i;
  function load() {
    request = body();
  }
  function bump() {
    return ++count;
  }
  load();
  total += request!.bytes.length;
  await gate;
  return bump();
}
function* helpersAcrossAYield(i: number) {
  let request: Body | undefined;
  let count = i;
  function load() {
    request = body();
  }
  function bump() {
    return ++count;
  }
  load();
  total += request!.bytes.length;
  yield 0;
  yield bump();
}
function startedGenerator(i: number) {
  const generator = helpersAcrossAYield(i);
  generator.next();
  return () => generator.next().value;
}
function fortyVariables(i: number) {
  const request = body();
  const a0 = i, a1 = i, a2 = i, a3 = i, a4 = i, a5 = i, a6 = i, a7 = i, a8 = i, a9 = i;
  const b0 = i, b1 = i, b2 = i, b3 = i, b4 = i, b5 = i, b6 = i, b7 = i, b8 = i, b9 = i;
  const c0 = i, c1 = i, c2 = i, c3 = i, c4 = i, c5 = i, c6 = i, c7 = i, c8 = i, c9 = i;
  const d0 = i, d1 = i, d2 = i, d3 = i, d4 = i, d5 = i, d6 = i, d7 = i, d8 = i, d9 = i;
  once(() => request.bytes.length);
  return [
    () => a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9,
    () => b0 + b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8 + b9,
    () => c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8 + c9,
    () => d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9,
  ];
}
function anArrayMethod(i: number) {
  let request = body();
  let count = i;
  total += [1, 2].map(n => {
    const length = request.bytes.length + n;
    request = body();
    return length;
  }).length;
  return () => ++count;
}
function methodsOfOneObject(i: number) {
  let request: Body | undefined = body();
  let count = i;
  once(() => {
    const length = request!.bytes.length;
    request = undefined;
    return length;
  });
  return {
    up: () => ++count,
    down: () => --count,
  }.up;
}
async function aCallbackThatCountsBeforeAnAwait(i: number) {
  const request = body();
  let count = i;
  [1, 2].forEach(n => {
    count += request.bytes.length + n;
  });
  await gate;
  return count;
}
async function anExecutorBeforeAnAwait(i: number) {
  const request = body();
  let count = i;
  await new Promise<void>(resolve => {
    count += request.bytes.length;
    resolve();
  });
  await gate;
  return count;
}
async function anAsyncArrowCalledAtOnce(i: number) {
  const request = body();
  let count = i;
  await (async () => {
    count += request.bytes.length;
  })();
  await gate;
  return count;
}
async function helpersThatCallEachOtherAcrossAnAwait(i: number) {
  let request: Body | undefined;
  let count = i;
  function bump() {
    return ++count;
  }
  function load() {
    request = body();
    bump();
  }
  load();
  total += request!.bytes.length;
  await gate;
  return bump();
}

function readByBoth(i: number) {
  const request = body();
  let count = i;
  once(() => request.bytes.length);
  return () => request.bytes.length + ++count;
}

function call(value: unknown): number {
  if (typeof value === "function") return call(value());
  if (Array.isArray(value)) return value.reduce((sum: number, each: unknown) => sum + call(each), 0);
  return typeof value === "number" ? value : typeof value === "string" ? value.length : 0;
}

async function judge(name: string, scenario: (i: number) => unknown) {
  watched = [];
  kept = [];
  emitter.listeners = [];
  gate = new Promise<void>(resolve => {
    release = resolve;
  });
  for (let i = 0; i < 16; i++) kept.push(scenario(i));
  await turn();
  gc();
  let alive = 0;
  for (const each of watched) if (each.deref() !== undefined) alive++;
  const verdict = alive * 4 <= watched.length ? "collected" : alive * 4 >= watched.length * 3 ? "kept" : alive + " of " + watched.length;
  emitter.emit();
  release();
  let sum = 0;
  for (const each of kept) sum += call(await each);
  console.log(name + ": " + verdict + ", " + sum);
}

await judge("nothing is stored to", nothingStored);
await judge("a counter beside it", aCounterBeside);
await judge("more than four variables", moreThanFourVariables);
await judge("both are stored to", bothStoredTo);
await judge("stored to before the closures are made", storedToBeforeTheClosures);
await judge("stored to by a helper that is only called", storedToByAHelper);
await judge("a timer", aTimer);
await judge("a listener", aListener);
await judge("in a loop", inALoop);
await judge("in a block", inABlock);
await judge("a closure in a closure", aClosureInAClosure);
await judge("a parameter", aParameter);
await judge("a caught error", aCaughtError);
await judge("three sets of closures", threeSets);
await judge("across an await", acrossAnAwait);
await judge("made after an await", madeAfterAnAwait);
await judge("helpers that are only called, across an await", helpersAcrossAnAwait);
await judge("helpers that are only called, across a yield", startedGenerator);
await judge("forty variables", fortyVariables);
await judge("a callback of an array method", anArrayMethod);
await judge("methods of one object", methodsOfOneObject);
await judge("a callback that counts before an await", aCallbackThatCountsBeforeAnAwait);
await judge("an executor before an await", anExecutorBeforeAnAwait);
await judge("an async arrow called at once", anAsyncArrowCalledAtOnce);
await judge("helpers that call each other, across an await", helpersThatCallEachOtherAcrossAnAwait);
await judge("read by the closure that stays", readByBoth);
await new Promise<void>(resolve => setTimeout(resolve, 60));
console.log(total);
