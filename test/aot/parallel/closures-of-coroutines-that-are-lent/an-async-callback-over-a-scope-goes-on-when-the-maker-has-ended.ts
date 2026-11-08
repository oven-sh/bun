const seen: number[] = [];
function each(list: number[], visit: (x: number) => unknown): void { for (let i = 0; i < list.length; i++) visit(list[i]); }
function sum(list: number[], k: number): number {
  let total = k;
  function bump(): void { total++; }
  bump();
  each(list, async x => { await null; total += x; await null; seen.push(total); });
  return total;
}
function tread(n: number): number { const a = [n, n + 1, n + 2]; return n ? tread(n - 1) + a[n % 3] : 0; }
let now = 0;
for (let round = 0; round < 200; round++) { now += sum([1, 2, 3], round * 100); tread(50); }
await new Promise<void>(resolve => setTimeout(resolve, 0));
Bun.gc(true);
let check = 0;
for (const value of seen) check = (check * 31 + value) % 1000003;
console.log(now, seen.length, check, seen.slice(0, 6).join(), seen.slice(-3).join());
