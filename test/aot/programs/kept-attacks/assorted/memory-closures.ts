// Assorted: memory closures. It prints what plain Bun prints.
type Handlers = { onA: () => number; onB: (x: number) => number; name: string };

function make(n: number): Handlers {
  return { onA: () => n, onB: (x) => x + n, name: "h" + n };
}
function use(h: Handlers, i: number): number {
  return (i & 127) === 0 ? h.onA() + h.onB(1) : h.name.length;
}
const kept: Handlers[] = [];
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const h = make(i);
  kept[i & 255] = h;
  sum += use(kept[(i * 7) & 255] ?? h, i);
}
console.log(sum, kept.length);
