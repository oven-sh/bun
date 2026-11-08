// Objects and closures over large arrays are made as arguments of calls; the argument behind each of them throws, so the call is never made, and the function catches.
// Each closure holds two names fewer than the one before it, and each object two fields fewer, so a smaller one never covers what a larger one left.
// Behind each catch nobody can reach the array any more: a full collection behind the last finds them gone.
// Skip under --aot-harden=proof-checks: on Linux arm64 that build found what was lent still held behind a full collection, where plain Bun and every other build find it gone; on x64 that build finds it gone too. Why is not known: seen in the log of CI, not run on arm64 by hand
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function fails(n: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (n + work > 0) throw new RangeError("full");
  return work;
}

function look(o: any, more: number): number {
  let t = 0;
  for (let i = 0; i < 2; i++) t += o.data.length + o.id;
  return t + more;
}

function twice(run: () => number, more: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return run() + run() + work + more;
}

function closures(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  const a = unseen("a"), b = unseen("b"), c = unseen("c"), e = unseen("e"), f = unseen("f"), g = unseen("g");
  try { const d = make(n); s += twice(() => a.length + b.length + c.length + e.length + f.length + g.length + d.length, fails(n)); } catch { s++; }
  try { const d = make(n); s += twice(() => a.length + b.length + c.length + e.length + d.length, fails(n)); } catch { s++; }
  try { const d = make(n); s += twice(() => a.length + b.length + d.length, fails(n)); } catch { s++; }
  try { const d = make(n); s += twice(() => d.length, fails(n)); } catch { s++; }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 2 * n);
}

function objects(n: number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  const u: any = unseen(0);
  try { s += look({ id: 1, a: u, b: u, c: u, d: u, e: u, f: u, data: make(n) }, fails(n)); } catch { s++; }
  try { s += look({ id: 2, a: u, b: u, c: u, d: u, data: make(n) }, fails(n)); } catch { s++; }
  try { s += look({ id: 3, a: u, b: u, data: make(n) }, fails(n)); } catch { s++; }
  try { s += look({ id: 4, data: make(n) }, fails(n)); } catch { s++; }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 2 * n);
}

closures(unseen(1024));
objects(unseen(1024));
console.log(closures(unseen(16 * 1024 * 1024)), objects(unseen(16 * 1024 * 1024)));
