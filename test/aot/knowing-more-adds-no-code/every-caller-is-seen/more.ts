
type Order = { id: number; total: number; tags: string[] };
function summarize(order: Order): string {
  let text = "#" + order.id + " " + order.total.toFixed(2);
  for (const tag of order.tags) text += " [" + tag + "]";
  return text;
}
const handlers = { summarize };
const n = Number(process.argv[2] ?? 3);
let out = "";
for (let i = 0; i < n; i++) out += summarize({ id: i, total: i * 1.5, tags: ["a", "b"] }) + "\n";
console.log(out);
