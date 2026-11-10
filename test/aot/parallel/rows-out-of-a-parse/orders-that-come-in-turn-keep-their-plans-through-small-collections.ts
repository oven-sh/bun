// A thousand orders of one record's names come in turn, a body a request, as clients of a server send them, and a small collection comes every 300 requests: three pass before an order
// comes round again. Its plan is kept: a plan goes only when the table has been asked more than twice as often as it holds plans since the plan was last found, and of a thousand orders in turn
// each is found once in a thousand askings. Counted in collections alone, every request built its plan anew: 7,000 instructions where parsing the body takes 2,400.
// COUNTER: RecordPlansTried <= 1000
// COUNTER: RecordPlansEvicted <= 0
// COUNTER: PeakRecordPlansCached <= 1000
// COUNTER: ObjectsParsedIntoRecords >= 20000
import { edenGC } from "bun:jsc";
interface Order { amount?: number; buyer?: number; city?: number; day?: number; email?: number; flag?: number; grade?: number; hours?: number; item?: number; job?: number; kind?: number; level?: number }
const names = ["amount", "buyer", "city", "day", "email", "flag", "grade", "hours", "item", "job", "kind", "level"];
let seed = Number(process.argv[2] ?? 7) | 0;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return (seed >>> 8) & 0xffff; }
const numberOfOrders = 1000, requests = Number(process.argv[3] ?? 20000), requestsBetweenCollections = Number(process.argv[4] ?? 300);
const texts = new Set<string>();
while (texts.size < numberOfOrders) {
  const picked = names.filter(() => next() & 1); if (!picked.length) continue;
  for (let i = picked.length - 1; i > 0; i--) { const j = next() % (i + 1); const t = picked[i]; picked[i] = picked[j]; picked[j] = t; }
  texts.add("[{" + picked.map((name, i) => '"' + name + '":' + (i + 1)).join() + "}]");
}
const bodies = [...texts];
function worth(orders: Order[]): number { let sum = 0; for (const order of orders) sum += (order.amount ?? 0) + (order.grade ?? 0) + (order.level ?? 0); return sum; }
let sum = 0;
for (let i = 0; i < requests; i++) {
  const orders: Order[] = JSON.parse(bodies[i % bodies.length]!);
  sum += worth(orders);
  if (i % requestsBetweenCollections === requestsBetweenCollections - 1) edenGC();
}
console.log("SAID " + sum);
export {};
