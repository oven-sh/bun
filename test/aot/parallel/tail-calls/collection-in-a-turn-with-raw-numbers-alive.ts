// the collector runs in turns of a self tail call while raw numbers and fresh objects go round
function mix(n: number, x: number, box: { v: number }): string {
  if (n === 0) return x.toFixed(2) + ":" + box.v;
  if (n % 50 === 0) (globalThis as any).Bun.gc(true);
  return mix(n - 1, x * 1.001 + 0.5, { v: box.v + n });
}
function deed(turns: number) {
  return mix(turns, 0.25, { v: 1 });
}
console.log(deed(3));
for (let i = 0; i < 3; i++) console.log(deed(120 + i));
console.log(deed(400));
