// With types.
let last: WeakRef<object>;
let sink = 0;
function make(n: number) {
  const made = { n };
  last = new WeakRef(made);
  return made;
}
function collect() {
  for (let round = 0; round < 4; round++) Bun.gc(true);
}
function report(label: string) {
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
}
const timer = () => new Promise<void>(resolve => setTimeout(resolve, 1));
function* yields(label: string) {
  yield 1;
  collect();
  report(label);
  const a = [label.length];
  yield a;
  return a[0];
}
async function stepsGenerator(label: string) {
  const steps = yields(label);
  steps.next();
  await timer();
  steps.next();
  steps.next();
  return 1;
}
async function set(n: number, wait: (label: string) => Promise<number | void>) {
  const holder = new Set([make(n)]);
  await wait("a set");
  return 1;
}
await set(0, stepsGenerator);
export {};
