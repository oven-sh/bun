// Four times a function hands a closure over a large array to a helper that it knows only as a value. The helper does more than call it (it asks for its length), so it is handed a copy of its own, and keeps nothing.
// Behind each call nobody can reach the closure, its copy or the array any more: a full collection behind the fourth call finds all four gone. Each closure holds two names fewer than the one before it.
const unseen = <T,>(x: T): T => [x][JSON.parse("0")];

function make(n: number): any {
  return n > 0 ? new Uint8Array(n).fill(1) : n;
}

function asks(run: any): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return run() + run.length + work;
}

function calls(run: () => number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return run() + run() + work;
}

function phases(n: number, helper: (run: () => number) => number): string {
  let s = 0;
  for (let i = 0; i < 2; i++) s = (s + i) | 0;
  const a = unseen("a"), b = unseen("b"), c = unseen("c"), e = unseen("e"), f = unseen("f"), g = unseen("g");
  { const d = make(n); s += helper(() => a.length + b.length + c.length + e.length + f.length + g.length + d.length); }
  { const d = make(n); s += helper(() => a.length + b.length + c.length + e.length + d.length); }
  { const d = make(n); s += helper(() => a.length + b.length + d.length); }
  { const d = make(n); s += helper(() => d.length); }
  const size = Bun.gc(true); // @ts-expect-error
  return s + " " + (size > 2 * n);
}

phases(unseen(1024), unseen(calls));
phases(unseen(1024), unseen(asks));
console.log(phases(unseen(16 * 1024 * 1024), unseen(asks)), phases(unseen(16 * 1024 * 1024), unseen(calls)));
