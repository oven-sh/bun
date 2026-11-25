// Bodies of one record's twelve optional names, each a shuffled subset of them: orders without end, and few of them come again. The plan of a parsed record is an entry of a cache:
// it goes when two collections have passed and the table has been asked more than twice as often as it holds plans since the plan was last found. The table used to keep a plan for every
// order that the order word of a cell can number, 8,029 here, for the life of the program. What it holds at the end is what was tried less what was forgotten: at most 600.
// The program collects every 500 bodies and nothing else collects where counts are taken: the counts are the same everywhere. With no collection at all nothing is forgotten.
// COUNTER: RecordPlansTried <= 11000
// COUNTER: RecordPlansEvicted >= 10400
interface Order { amount?: number; buyer?: number; city?: number; day?: number; email?: number; flag?: number; grade?: number; hours?: number; item?: number; job?: number; kind?: number; level?: number }
const names = ["amount", "buyer", "city", "day", "email", "flag", "grade", "hours", "item", "job", "kind", "level"];
let seed = Number(process.argv[2] ?? 7) | 0;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return (seed >>> 8) & 0xffff; }
function body(): string {
  const picked: string[] = [];
  let mask = next() & 4095; if (!mask) mask = 1;
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) picked.push(names[i]);
  for (let i = picked.length - 1; i > 0; i--) { const j = next() % (i + 1); const t = picked[i]; picked[i] = picked[j]; picked[j] = t; }
  let text = "{";
  for (let i = 0; i < picked.length; i++) text += (i ? "," : "") + '"' + picked[i] + '":' + (i + 1);
  return text + "}";
}
function worth(orders: Order[]): number { let sum = 0; for (const order of orders) sum += (order.amount ?? 0) + (order.grade ?? 0) + (order.level ?? 0); return sum; }
const last = Number(process.argv[3] ?? 60000), bodiesBetweenCollections = Number(process.argv[4] ?? 500);
let total = 0;
for (let done = 0; done < last; done++) {
  const orders: Order[] = JSON.parse("[" + body() + "]");
  total += worth(orders);
  if (bodiesBetweenCollections && done % bodiesBetweenCollections === bodiesBetweenCollections - 1) Bun.gc(true);
}
console.log("SAID " + last + " total " + total);
export {};
