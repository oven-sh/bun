// Small functions that lend an object or a closure over a large array are called under a try of their caller; where a body is copied into the caller, what it lent lies in the caller's frame and under the caller's handler.
// The helpers throw; behind each catch nobody can reach the array any more. Each closure holds two names fewer than the one before it, and each object two fields fewer.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
const a = unseen("a"), b = unseen("b"), c = unseen("c"), e = unseen("e"), f = unseen("f"), g = unseen("g");
const u: any = unseen(0);

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function look(o: any): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.data.length + o.id;
  if (t > 0) throw new RangeError("full");
  return t;
}

function twice(run: () => number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const sum = run() + run() + work;
  if (sum > 0) throw new RangeError("full");
  return sum;
}

function object7(n: number): number { return look({ id: 1, a: u, b: u, c: u, d: u, e: u, f: u, data: make(n) }); }
function object5(n: number): number { return look({ id: 2, a: u, b: u, c: u, d: u, data: make(n) }); }
function object3(n: number): number { return look({ id: 3, a: u, b: u, data: make(n) }); }
function object1(n: number): number { return look({ id: 4, data: make(n) }); }
function closure7(n: number, p: string, q: string, r: string, s: string, t: string, v: string): number { const d = make(n); return twice(() => p.length + q.length + r.length + s.length + t.length + v.length + d.length); }
function closure5(n: number, p: string, q: string, r: string, s: string): number { const d = make(n); return twice(() => p.length + q.length + r.length + s.length + d.length); }
function closure3(n: number, p: string, q: string): number { const d = make(n); return twice(() => p.length + q.length + d.length); }
function closure1(n: number): number { const d = make(n); return twice(() => d.length); }

function objects(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  try { s += object7(n); } catch { s++; }
  try { s += object5(n); } catch { s++; }
  try { s += object3(n); } catch { s++; }
  try { s += object1(n); } catch { s++; }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 2 * n);
}

function closures(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  try { s += closure7(n, a, b, c, e, f, g); } catch { s++; }
  try { s += closure5(n, a, b, c, e); } catch { s++; }
  try { s += closure3(n, a, b); } catch { s++; }
  try { s += closure1(n); } catch { s++; }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 2 * n);
}

objects(unseen(1024));
closures(unseen(1024));
console.log(objects(unseen(16 * 1024 * 1024)), closures(unseen(16 * 1024 * 1024)));
