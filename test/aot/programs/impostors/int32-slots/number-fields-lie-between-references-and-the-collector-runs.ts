// Number fields that look like int32 alternate with fields that hold objects, strings and arrays, so that narrow slots lie beside references. The numbers are bit patterns of every kind:
// small multiples of 8 and 16, which look like offsets of cells, all ones, the edges of int32. Some fields get a fraction by a hidden store and leave their slots. 30000 objects survive full and small collections.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Mixed {
  a = 0;
  first: { tag: number } | null = null;
  b = 0;
  name = "";
  c = 0;
  list: number[] | null = null;
  d = 0;
  e = 0;
  next: Mixed | null = null;
  f = 0;
}
function clamp(value: number) {
  return Math.max(Math.min(value | 0, 2147483647), -2147483643);
}
function fill(mixed: Mixed, i: number, previous: Mixed | null) {
  const pattern = Math.imul(i, 2654435761) | 0;
  mixed.a = clamp(pattern);
  mixed.first = { tag: i };
  mixed.b = (i << 4) | 0;
  mixed.name = "name" + i;
  mixed.c = (i << 3) | 0;
  mixed.list = [i, i + 1];
  const set = () => { mixed.d = ~i; };
  set();
  mixed.e = Math.abs(i & 0xffff);
  mixed.next = previous;
  mixed.f = -1;
}
function check(mixed: Mixed, i: number, previous: Mixed | null) {
  const pattern = Math.imul(i, 2654435761) | 0;
  return (
    (i % 97 === 0 ? mixed.a === i + 0.5 : mixed.a === clamp(pattern)) &&
    mixed.first!.tag === i &&
    mixed.b === ((i << 4) | 0) &&
    mixed.name === "name" + i &&
    (i % 89 === 0 ? mixed.c === 2 ** 40 + i : mixed.c === ((i << 3) | 0)) &&
    mixed.list!.length === 2 &&
    mixed.list![1] === i + 1 &&
    mixed.d === ~i &&
    mixed.e === (i & 0xffff) &&
    mixed.next === previous &&
    mixed.f === -1
  );
}
function churn(rounds: number) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += [{ tag: i }, "junk" + (i & 511), [i]].length;
  return sum;
}
const all: Mixed[] = [];
const keys: string[] = JSON.parse('["a","c"]');
for (let i = 0; i < 30000; i++) {
  const mixed = new Mixed();
  handOver(mixed);
  fill(mixed, i, all[i - 1] ?? null);
  if (i % 97 === 0) (mixed as any)[keys[0]] = i + 0.5;
  if (i % 89 === 0) Reflect.set(mixed, keys[1], 2 ** 40 + i);
  all.push(mixed);
}
function count() {
  let right = 0;
  for (let i = 0; i < all.length; i++) if (check(all[i], i, all[i - 1] ?? null)) right++;
  return right;
}
console.log("filled:", count());
console.log("garbage", churn(1_500_000), count());
Bun.gc(true);
console.log("a full collection:", count());
for (let i = 0; i < all.length; i += 2) fill(all[i], i, all[i - 1] ?? null);
for (let i = 0; i < all.length; i += 2) {
  if (i % 97 === 0) (all[i] as any)[keys[0]] = i + 0.5;
  if (i % 89 === 0) Reflect.set(all[i], keys[1], 2 ** 40 + i);
}
console.log("garbage", churn(1_500_000), count());
Bun.gc(true);
Bun.gc(true);
console.log("old objects filled again:", count(), JSON.stringify({ ...all[97], next: null }), Object.keys(all[89]).join());
