// "Result 0 is parameter 1, or this constant, and nothing else" needs every way out of the function: the end of the body answers undefined, a default stands in for a missing argument, a parameter is stored to before it is returned, `finally` has the last word, a getter or a coroutine wraps the answer, and a sloppy `this` is boxed elsewhere.
function sometimesNothing(x: number): number | undefined {
  if (x > 0) return 1;
}
function emptyReturn(x: number): string | undefined {
  if (x > 0) return "positive";
  return;
}
function switchWithoutDefault(x: number): string | undefined {
  switch (x) {
    case 0:
      return "zero";
    case 1:
      return "one";
  }
}
function loopThatMayEnd(list: number[]): number | undefined {
  for (const n of list) if (n > 2) return n;
}
function withDefault(x: number | undefined = 5): number {
  return x;
}
function defaultFromAnother(a: { tag: string }, b: { tag: string } = a): { tag: string } {
  return b;
}
function defaultIsFresh(a: { tag: string } = { tag: "fresh default" }): { tag: string } {
  return a;
}
function storedBefore(x: number): number {
  x = x | 0;
  return x;
}
function storedOnOnePath(x: { tag: string } | null): { tag: string } {
  if (!x) x = { tag: "made here" };
  return x;
}
function compound(x: number): number {
  x += 0.5;
  return x;
}
function postfix(x: number): number {
  return x++;
}
function prefix(x: number): number {
  return ++x;
}
function destructured({ x }: { x: number }): number {
  return x;
}
function swapped(a: number, b: number): number {
  [a, b] = [b, a];
  return a;
}
function storedByAClosure(x: number): number {
  const set = () => {
    x = -1;
  };
  if (x > 100) set();
  return x;
}
function finallyWins(x: number): number {
  try {
    return x;
  } finally {
    if (x === 3) return -3;
  }
}
function finallyStoresTooLate(x: number): number {
  try {
    return x;
  } finally {
    x = -1;
  }
}
function catchAnswers(x: { n: number } | null): number {
  try {
    return x!.n;
  } catch {
    return -1;
  }
}
function voidOf(x: number): undefined {
  return void x;
}
function commaOf(a: number, b: number): number {
  return void a, b;
}
function logical(a: number, b: number): number {
  return a && b;
}
function coalesced(a: number | null | undefined, b: number): number {
  return a ?? b;
}
const show = (x: unknown) => (typeof x === "object" && x !== null ? (x as { tag: string }).tag : String(x));
let warm = 0;
for (let i = 1; i < 2000; i++) {
  warm += sometimesNothing(i)! + emptyReturn(i)!.length + switchWithoutDefault(i & 1)!.length + loopThatMayEnd([i + 3])! + withDefault(i) + storedBefore(i) + postfix(i) + prefix(i) + destructured({ x: i }) + swapped(i, 1);
  warm += storedByAClosure(i % 100) + finallyWins(i + 3) + finallyStoresTooLate(i) + catchAnswers({ n: i }) + commaOf(1, i) + logical(1, i) + coalesced(i, 1) + compound(i);
}
console.log(warm);
console.log([sometimesNothing(0), sometimesNothing(-1), emptyReturn(0), switchWithoutDefault(2), loopThatMayEnd([1, 2]), loopThatMayEnd([])].map(show).join());
console.log([withDefault(), withDefault(undefined), withDefault(0), withDefault(null as unknown as undefined), withDefault(NaN)].map(show).join());
const a = { tag: "a" };
const b = { tag: "b" };
console.log(defaultFromAnother(a) === a, defaultFromAnother(a, undefined) === a, defaultFromAnother(a, b) === b, defaultIsFresh(a) === a, defaultIsFresh() === defaultIsFresh(), defaultIsFresh(undefined).tag);
console.log([storedBefore(1.9), storedBefore(-1.9), storedBefore(2 ** 32 + 1), storedBefore(NaN), storedBefore("7" as unknown as number), storedOnOnePath(a) === a, storedOnOnePath(null), storedOnOnePath(null) === storedOnOnePath(null)].map(show).join());
console.log([compound(1), postfix(1), prefix(1), postfix("4" as unknown as number), typeof postfix("4" as unknown as number), postfix(2147483647), prefix(2147483647), swapped(1, 2), storedByAClosure(101), storedByAClosure(100)].map(show).join());
console.log([finallyWins(3), finallyWins(4), finallyStoresTooLate(9), catchAnswers(null), voidOf(1), commaOf(1, 2), logical(0, 2), logical(NaN, 2), logical(1, 2), coalesced(null, 2), coalesced(undefined, 2), coalesced(0, 2), coalesced(NaN, 2)].map(show).join());

// The caller believes the answer and goes on with it.
function lengthOfAnswer(x: number): number {
  const answer = emptyReturn(x);
  return answer === undefined ? -1 : answer.length;
}
function indexByAnswer(x: number): string {
  return ["none", "one"][sometimesNothing(x) ?? 0];
}
function addToAnswer(x: number): number {
  return (sometimesNothing(x) as number) + 1;
}
console.log(lengthOfAnswer(1), lengthOfAnswer(0), indexByAnswer(1), indexByAnswer(0), addToAnswer(1), addToAnswer(0));

// What a call answers is not what the body returns.
async function asyncIdentity<T>(x: T): Promise<T> {
  return x;
}
function* generatorIdentity<T>(x: T): Generator<never, T> {
  return x;
}
class Wrapped {
  constructor(private inner: { tag: string }) {}
  get value(): { tag: string } {
    return this.inner;
  }
  set value(v: { tag: string }) {
    this.inner = { tag: v.tag + " (wrapped)" };
  }
}
const promised = asyncIdentity(a);
const generated = generatorIdentity(a);
console.log((promised as unknown) === a, promised instanceof Promise, (await promised) === a, (generated as unknown) === a, generated.next().value === a);
const thenable = { then: (resolve: (x: string) => void) => resolve("unwrapped") };
console.log(await asyncIdentity(thenable), await asyncIdentity(Promise.resolve(a)) === a);
const wrapped = new Wrapped(a);
const assigned = (wrapped.value = b);
console.log(assigned === b, wrapped.value.tag, wrapped.value === wrapped.value);

// An assignment answers what was assigned, not what the target holds afterwards.
const frozen = Object.freeze({ n: 1 });
function assignAndAnswer(target: { n: number }, n: number): number {
  try {
    return (target.n = n);
  } catch {
    return -1;
  }
}
const ints = new Uint8Array(1);
function assignElement(list: Uint8Array, n: number): number {
  return (list[0] = n);
}
console.log(assignAndAnswer({ n: 0 }, 5), assignAndAnswer(frozen as { n: number }, 5), frozen.n, assignElement(ints, 300), ints[0], assignElement(ints, 1.5), ints[0]);
