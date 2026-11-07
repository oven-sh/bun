// Four times a function hands a helper a closure over a large array made for that call alone; each time the helper throws behind its second call of the closure, and the function catches.
// Behind each catch nobody can reach the array any more: a full collection behind the fourth finds all four gone.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function twice(run: () => number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const sum = run() + run() + work;
  if (sum > 0) throw new RangeError("full");
  return sum;
}

function phases(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  const a = unseen("a"), b = unseen("b"), c = unseen("c"), e = unseen("e"), f = unseen("f"), g = unseen("g");
  try { const d = make(n); s += twice(() => a.length + b.length + c.length + e.length + f.length + g.length + d.length); } catch { s++; }
  try { const d = make(n); s += twice(() => a.length + b.length + c.length + e.length + d.length); } catch { s++; }
  try { const d = make(n); s += twice(() => a.length + b.length + d.length); } catch { s++; }
  try { const d = make(n); s += twice(() => d.length); } catch { s++; }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 3 * n);
}

phases(unseen(1024));
console.log(phases(unseen(16 * 1024 * 1024)));
