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
async function waitsOnOnePath(label: string) {
  let kept: number | void = 0;
  if (label.length > 1000) kept = await timer();
  else await timer();
  collect();
  report(label);
  return kept;
}
async function mapFilledBySet(n: number, wait: (label: string) => Promise<number | void>) {
  const holder = new Map();
  holder.set(n, make(n));
  await wait("a map filled by set");
  return 1;
}
await mapFilledBySet(0, waitsOnOnePath);
export {};
