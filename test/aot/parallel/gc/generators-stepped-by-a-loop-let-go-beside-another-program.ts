// locals-of-generators-set-to-null-behind-yields-let-go.ts with the two forms that a loop steps, in one executable with another program: there `registry.register(x, name)` goes through a native call frame.
// Prints what the compiler saves: objects that are collected earlier
// Entry points: ../bundler/json-named-exports/main.ts
// Todo: rows 3465 and 3468: `stepped by for of` prints KEPT, and on x64 `delegated to` as well: the argument of the native call stays in a word of the stack, and the frame of the resumed generator lies over that word and has not written it
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more = 0): void {
  sum += (thing?.payload.length ?? 0) + more;
}
const finalized = new Set<string>();
const registry = new FinalizationRegistry<string>(name => finalized.add(name));
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const lines: string[] = [];
const odd = (n: number) => n % 2 === 1;

function* yieldsInALoop(name: string, turns: number): Generator<number, void> {
  let x: Thing | null = make();
  registry.register(x, name);
  use(x);
  for (let i = 0; i < turns; i++) yield i;
  x = null;
  Bun.gc(true);
  yield -1;
}
function* readsOnOneWay(name: string, reads: boolean): Generator<number, void> {
  let x: Thing | null = make();
  registry.register(x, name);
  if (reads) use(x);
  yield 1;
  x = null;
  Bun.gc(true);
  yield 2;
}
function* yieldsTwice(name: string): Generator<number, void> {
  let x: Thing | null = make();
  registry.register(x, name);
  use(x);
  yield 1;
  yield 2;
  x = null;
  Bun.gc(true);
  yield 3;
}
function* holdsTwo(first: string, second: string): Generator<number, void> {
  let x: Thing | null = make();
  let y: Thing | null = make();
  registry.register(x, first);
  registry.register(y, second);
  use(x);
  use(y);
  yield 1;
  x = null;
  y = null;
  Bun.gc(true);
  yield 2;
}
function* assignsAgainOnOneWay(first: string, second: string, again: boolean): Generator<number, void> {
  let x: Thing | null = make();
  registry.register(x, first);
  use(x);
  if (again) {
    x = make();
    registry.register(x, second);
    use(x);
  }
  yield 1;
  x = null;
  Bun.gc(true);
  yield 2;
}
function* setsToUndefined(name: string): Generator<number, void> {
  let x: Thing | undefined = make();
  registry.register(x, name);
  use(x);
  yield 1;
  x = undefined;
  Bun.gc(true);
  yield 2;
}
function* inATry(name: string): Generator<number, void> {
  let x: Thing | null = make();
  try {
    registry.register(x, name);
    use(x);
    yield 1;
  } finally {
    x = null;
    Bun.gc(true);
  }
  yield 2;
}
function* everyTurn(prefix: string, turns: number): Generator<number, void> {
  for (let i = 0; i < turns; i++) {
    let x: Thing | null = make();
    registry.register(x, prefix + i);
    use(x);
    yield i;
    x = null;
    Bun.gc(true);
  }
}
const last = <T, R>(iterator: Generator<T, R>): R => {
  for (;;) {
    const step = iterator.next();
    if (step.done) return step.value;
  }
};
const forms: [string, () => Generator<number, void>, string[]][] = [
  ["yields in a loop", () => yieldsInALoop("loop", 3), ["loop"]],
  ["yields in a loop that takes no turn", () => yieldsInALoop("no turn", 0), ["no turn"]],
  ["reads on one way, taken", () => readsOnOneWay("taken", odd(1)), ["taken"]],
  ["reads on one way, not taken", () => readsOnOneWay("not taken", odd(2)), ["not taken"]],
  ["yields twice", () => yieldsTwice("twice"), ["twice"]],
  ["holds two", () => holdsTwo("first of two", "second of two"), ["first of two", "second of two"]],
  ["assigns again", () => assignsAgainOnOneWay("before", "after", odd(1)), ["before", "after"]],
  ["does not assign again", () => assignsAgainOnOneWay("only", "never", odd(2)), ["only"]],
  ["sets to undefined", () => setsToUndefined("undefined"), ["undefined"]],
  ["in a try", () => inATry("try"), ["try"]],
  ["every turn", () => everyTurn("turn ", 3), ["turn 0", "turn 1", "turn 2"]],
];
for (const [form, start, names] of forms) {
  last(start());
  await turn();
  lines.push(`${form}: ${names.map(name => (finalized.has(name) ? "collected" : "KEPT")).join(", ")}`);
}
// However it is stepped.
function* delegates(name: string): Generator<number, void> {
  yield* setsToUndefined(name);
}
const steppers: [string, (name: string) => void][] = [
  ["stepped by for of", name => { for (const step of setsToUndefined(name)) sum += step; }],
  ["spread", name => { sum += [...setsToUndefined(name)].length; }],
  ["delegated to", name => { for (const step of delegates(name)) sum += step; }],
];
for (const [form, step] of steppers) {
  step(form);
  await turn();
  lines.push(`${form}: ${finalized.has(form) ? "collected" : "KEPT"}`);
}
console.log(lines.join("\n"));
console.log(sum > 0);
