// A generator that has set a local to null behind a yield lets go of the object while it still runs.
// Prints what the compiler saves: objects that are collected earlier
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
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);

function* generatorRegistered(name: string): Generator<number, void> {
  let x: Thing | null = make();
  registry.register(x, name);
  use(x);
  yield 1;
  x = null;
  Bun.gc(true);
  yield 2;
}
const last = <T, R>(iterator: Generator<T, R>): R => {
  for (;;) {
    const step = iterator.next();
    if (step.done) return step.value;
  }
};
last(generatorRegistered("generator"));
await turn();
say("FinalizationRegistry, a generator", finalized.has("generator"));
console.log(lines.join("\n"));
console.log(sum > 0);
