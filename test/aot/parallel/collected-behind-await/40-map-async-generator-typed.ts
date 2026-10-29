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
const timer = () => new Promise<void>(resolve => setTimeout(resolve, 1));
async function* yieldsAsync(label: string) {
  await timer();
  collect();
  console.log(label + ":", last.deref() !== undefined ? "kept" : "collected");
  const a = [label.length];
  yield a;
  return a[0];
}
async function walksAsyncGenerator(label: string) {
  for await (const step of yieldsAsync(label)) sink += step[0];
  return 1;
}
async function map(n: number, wait: (label: string) => Promise<number | void>) {
  const holder = new Map([[n, make(n)]]);
  await wait("a map");
  return 1;
}
await map(0, walksAsyncGenerator);
export {};
