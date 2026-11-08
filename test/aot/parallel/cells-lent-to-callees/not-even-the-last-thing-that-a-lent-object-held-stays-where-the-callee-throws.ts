// A function hands a small test an object that holds a large array made for that call alone; the test throws and the function catches. Behind the catch nobody can reach the array any more.
// Objects that one callee reads by the same names hold them at the same places, so a later object covers what an earlier one left: what can stay is the last. The function goes on with smaller work, none of which covers it.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function look(o: any): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.data.length + o.first.length;
  if (t > 0) throw new RangeError("full");
  return t;
}

function small(o: any): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.only;
  return t;
}

function phases(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  const w: any = unseen("w");
  try { s += look({ first: w, a: w, b: w, data: make(n) }); } catch { s++; }
  try { s += look({ first: w, data: make(n) }); } catch { s++; }
  for (let i = 0; i < 4; i++) s += small({ only: i }) + make(0);
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > n / 2);
}

phases(unseen(1024));
console.log(phases(unseen(16 * 1024 * 1024)));
