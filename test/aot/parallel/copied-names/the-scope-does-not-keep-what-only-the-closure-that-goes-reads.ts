// A closure that goes reads a constant and stores to a counter. The counter lies in the scope, which a closure that stays holds, or the function itself while it waits. The constant does not lie there.
// Plain Bun keeps them all: there both names lie in one scope.
import "../../fixtures/jsc-shell-functions.ts";
declare function gc(): void;

interface Body { bytes: number[] }

let watched: WeakRef<Body>[] = [];
let total = 0;
let release: () => void = () => {};
let gate: Promise<void> = Promise.resolve();

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

function aClosureThatStaysCounts(i: number) {
  const request = body();
  let count = i;
  once(() => (count += request.bytes.length));
  return () => ++count;
}
function twoConstantsOfTheClosureThatGoes(i: number) {
  const request = body();
  const answer = body();
  let count = i;
  once(() => (count += request.bytes.length + answer.bytes.length));
  return () => ++count;
}
function aClosureInTheClosureThatGoes(i: number) {
  const request = body();
  let count = i;
  once(() => {
    once(() => (count += request.bytes.length));
    return 0;
  });
  return () => ++count;
}
function* aGeneratorThatWaits(i: number) {
  const request = body();
  let count = i;
  once(() => (count += request.bytes.length));
  yield count;
  return ++count;
}
async function aFunctionThatWaits(i: number) {
  const request = body();
  let count = i;
  once(() => (count += request.bytes.length));
  await gate;
  return ++count;
}
function theClosureThatStaysReadsIt(i: number) {
  const request = body();
  let count = i;
  once(() => (count += request.bytes.length));
  return () => request.bytes.length + ++count;
}

async function judge(name: string, scenario: (i: number) => unknown) {
  watched = [];
  gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const kept: unknown[] = [];
  for (let i = 0; i < 16; i++) {
    const made = scenario(i);
    if (made !== null && typeof made === "object" && "next" in made) (made as Generator<number>).next();
    kept.push(made);
  }
  await turn();
  gc();
  let alive = 0;
  for (const each of watched) if (each.deref() !== undefined) alive++;
  const verdict = alive * 4 <= watched.length ? "collected" : alive * 4 >= watched.length * 3 ? "kept" : alive + " of " + watched.length;
  release();
  let sum = 0;
  for (const each of kept) {
    const value = await each;
    if (typeof value === "function") sum += value();
    else if (typeof value === "number") sum += value;
    else sum += (value as Generator<number, number>).next().value;
  }
  console.log(name + ": " + verdict + ", " + sum);
}

await judge("a closure that stays counts", aClosureThatStaysCounts);
await judge("two constants of the closure that goes", twoConstantsOfTheClosureThatGoes);
await judge("a closure in the closure that goes", aClosureInTheClosureThatGoes);
await judge("a generator that waits", aGeneratorThatWaits);
await judge("a function that waits", aFunctionThatWaits);
await judge("the closure that stays reads it", theClosureThatStaysReadsIt);
console.log(total);
/* Output:
a closure that stays counts: collected, 648
two constants of the closure that goes: collected, 1160
a closure in the closure that goes: collected, 648
a generator that waits: collected, 648
a function that waits: collected, 648
the closure that stays reads it: kept, 1160
3672
*/
