// A spread copies what lies beside the slots of its source too.
type Pair = { a: number; b: number };
function make(a: number, b: number): Pair {
  return { a, b };
}
function copyAndAskForAnotherName(p: Pair): unknown {
  if (p == null) return -1;
  const c = { ...p };
  return (c as any).zz;
}
function copyAndHas(p: Pair): boolean {
  if (p == null) return false;
  const c = { ...p };
  return "zz" in c;
}
function copyAndRead(p: Pair): unknown {
  if (p == null) return -1;
  const c = { ...p };
  return c.a;
}
function copyAndStore(p: Pair): unknown {
  if (p == null) return -1;
  const c = { ...p };
  c.a = 9;
  return (c as any).a;
}
function put(o: any, name: string, value: unknown): void {
  o[name] = value;
}

const names = ["zz", "a"];
const pool: Pair[] = [];
for (let i = 0; i < 64; i++) pool.push(make(i, i + 1));
const withAnotherName = make(1, 2);
put(withAnotherName, names[0], 7);
const withText = make(3, 4);
put(withText, names[1], "text");

let total = 0;
for (let round = 0; round < 3000; round++) {
  const p = pool[round & 63];
  total += (copyAndRead(p) as number) + (copyAndStore(p) as number) + (copyAndAskForAnotherName(p) === undefined ? 1 : 0) + (copyAndHas(p) ? 1 : 0);
}
console.log(total);
for (const p of [withAnotherName, withText]) console.log(copyAndAskForAnotherName(p), copyAndHas(p), copyAndRead(p), copyAndStore(p));
