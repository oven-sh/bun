// A function keeps many values across calls on a path that it does not take. On the path that it takes, its frame holds nothing of what earlier calls left on the stack.
// Prints what the compiler saves: objects that are collected earlier
// Entry points: ../bundler/json-named-exports/main.ts
// Todo: Not every time: row 3468: prints KEPT where a word that an earlier call left lies inside the frame of the function that collects, or of its caller, and that frame has not written it. Which of the calls are hit goes by the layout of the build
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
const odd = (n: number) => n % 2 === 1;

// Leaves the object in words of the stack, so many calls down.
function registersBelow(name: string, calls: number): number {
  if (calls > 0) return registersBelow(name, calls - 1) + 1;
  const x = make();
  registry.register(x, name);
  use(x);
  return 0;
}
function collectsOnTheCommonPath(rare: boolean): void {
  if (rare) {
    const a = make();
    const b = make();
    const c = make();
    const d = make();
    const e = make();
    const f = make();
    const g = make();
    const h = make();
    use(a);
    use(b);
    use(c);
    use(d);
    use(e);
    use(f);
    use(g);
    use(h);
    use(h);
    use(g);
    use(f);
    use(e);
    use(d);
    use(c);
    use(b);
    use(a);
  }
  Bun.gc(true);
}
function collectsBeforeItKeepsAnything(): void {
  Bun.gc(true);
  const a = make();
  const b = make();
  const c = make();
  const d = make();
  const e = make();
  const f = make();
  use(a);
  use(b);
  use(c);
  use(d);
  use(e);
  use(f);
  use(f);
  use(e);
  use(d);
  use(c);
  use(b);
  use(a);
}
function collectsInFrontOfALoop(turns: number): void {
  Bun.gc(true);
  for (let i = 0; i < turns; i++) {
    const a = make();
    const b = make();
    const c = make();
    const d = make();
    use(a);
    use(b);
    use(c);
    use(d);
    use(d);
    use(c);
    use(b);
    use(a);
  }
}
const lines: string[] = [];
const forms: [string, () => void][] = [
  ["skips its rare path", () => collectsOnTheCommonPath(odd(2))],
  ["collects before it keeps anything", () => collectsBeforeItKeepsAnything()],
  ["collects in front of a loop", () => collectsInFrontOfALoop(2)],
];
for (const [form, collect] of forms) {
  const kept: number[] = [];
  // From 1: without a call in between, the object would be a value of this loop's own.
  for (let calls = 1; calls < 12; calls++) {
    const name = `${form} ${calls}`;
    sum += registersBelow(name, calls);
    collect();
    await turn();
    if (!finalized.has(name)) kept.push(calls);
  }
  lines.push(`${form}: ${kept.length ? "KEPT below " + kept.join(", ") + " calls" : "collected"}`);
}
console.log(lines.join("\n"));
console.log(sum > 0);
