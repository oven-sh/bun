let later: (() => number) | undefined;
function now(f: () => number): number { return f(); }
function nowAndLater(f: () => number): number { later = f; return f(); }
function work(k: number): number { let n = k; const a = now(() => ++n); const b = nowAndLater(() => ++n); return a * 100 + b; }
const first = work(1);
const again = later!();
const second = work(5);
console.log(first, again, later!(), second, later!());
