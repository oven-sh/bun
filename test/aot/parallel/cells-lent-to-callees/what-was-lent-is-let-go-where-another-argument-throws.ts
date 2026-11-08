// Objects and closures over large arrays are made as arguments of calls; the argument behind each of them throws, so the call is never made, and the function catches.
// Each closure holds two names fewer than the one before it, and each object two fields fewer, so a smaller one never covers what a larger one left.
// Behind each catch nobody can reach the array any more: a full collection behind the last finds them gone.
// Skip on linux arm64 under --aot-harden=proof-checks: there that build prints "5 true 5 true": two of the four arrays are still held at the collection; plain Bun and every other build print "5 false 5 false", and so does that build on x64. Where the caller asks for the collection, behind the return of closures() and objects(), that build prints "false" there too: what holds them lies in the frame and the registers of the function itself. Under the flag what is lent is made in the heap; objects() moves the second object into x22 in front of the call that throws, and nothing writes x22 again: a dead copy, which the collector reads
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
