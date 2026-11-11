// STATISTIC: CallsInlined >= 6
// The items are what their declared type says and have a name more: everyday TypeScript. The loop is built twice; its typed copy counts on the shape that the declared type names and is left in the first turn.
// All the turns that are left run in the other copy: it opens guesses of its own, so the three helpers are copied into it too.
interface Item { id: number; weight: number; kind: number }
const make = (i: number) => ({ id: i, weight: (i * 7) % 5 + 0.5, kind: i % 3, note: "n" + i });
const ITEMS: Item[] = Array.from({ length: 24 }, (_, i) => make(i));
const a = (x: number) => { x = x / 2 + 1; return x * x; }, b = (x: number) => { x = x + 1; if (x > 50) x = 50; return -(Math.round(x * 10) / 10); }, c = (x: number) => { x = x * x / 2; if (x > 50) x = 50; return Math.round((x + 1) * 10) / 10; };
function f(items: Item[], t: number): number { let s = 0; for (const item of items) { const k = (item.kind + t) % 3, x = item.weight + item.id; s += k === 0 ? a(x) : k === 1 ? b(x) : c(x); } return Math.abs(s); }
(globalThis as any).kept = f;
const n = +(process.argv[2] ?? 300); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(ITEMS, t)) % 1000003; console.log(Math.floor(sum));
