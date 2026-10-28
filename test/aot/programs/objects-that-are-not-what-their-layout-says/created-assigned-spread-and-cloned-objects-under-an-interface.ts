// Object.create, Object.assign, a spread, structuredClone and Object.fromEntries make what an interface describes
interface Pair {
  a: number;
  b: number;
}
function tell(p: Pair): string {
  return (
    p.a +
    "|" +
    p.b +
    "|" +
    Object.keys(p).join() +
    "|" +
    Object.getPrototypeOf(p)?.constructor?.name +
    "|" +
    (p instanceof Object)
  );
}
const base: Pair = { a: 1, b: 2 };
const list: Pair[] = [
  base,
  Object.create(base),
  Object.assign({}, base),
  { ...base },
  structuredClone(base),
  Object.fromEntries([
    ["b", 5],
    ["a", 4],
  ]) as unknown as Pair,
];
for (let round = 0; round < 3; round++) for (const p of list) console.log(tell(p));
