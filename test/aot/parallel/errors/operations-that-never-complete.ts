// Each of these has values for all its operands and none for its result: it never completes.
function fail(text: string): never {
  throw new Error(text);
}
function readsBehindACallThatThrows(): number {
  const pair = { left: fail("no") };
  return pair.left;
}
const empty: any = {};
const nothing: any = null;
class Made {}
const arrow: any = () => 1;
const poisoned = {
  get poison(): number {
    throw new Error("poison");
  },
};
class Holder {
  #held = 1;
  static heldBy(o: any) {
    return o.#held;
  }
}
function lengthOf(v: unknown): number {
  return typeof v === "string" ? v.length : 0;
}
const cases: (() => unknown)[] = [
  readsBehindACallThatThrows,
  () => empty.absent(),
  () => nothing.name,
  () => (Made as any)(),
  () => new arrow(),
  () => poisoned.poison,
  () => {
    for (const x of undefined as any) console.log(x);
  },
  () => Holder.heldBy({}),
  () => (Symbol() as any) + 1,
  () => lengthOf(new Proxy((a: number) => a, {})),
];
for (const run of cases) {
  try {
    console.log(run());
  } catch (error) {
    console.log((error as Error).name);
  }
}
