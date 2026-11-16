function chain(n: number, step: (x: number) => number, other: (x: number) => number): number {
  let current = step; let t = 0;
  for (let i = 0; i < n; i++) { t = current(t); current = current === step ? other : step; }
  return t;
}
function turns(n: number, step: (x: number) => number, other: (x: number) => number): number {
  let current = step; let t = 0;
  for (let i = 0; i < n; i++) { t = current(t); current = i & 1 ? step : other; }
  return t;
}
function work(k: number): string { return chain(5, x => x + k, x => x * 2) + ":" + turns(5, x => x + k, x => x * 2); }
console.log(work(1), work(3));
