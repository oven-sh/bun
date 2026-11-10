// Two rows in an order of their own get a plan. Three hundred other orders come in turn, ten times over, and ten collections pass: the three hundred keep their plans, and the one
// that nobody asked for is forgotten. Its order comes again: the plan is built again, under the number that the order has had since its first row, and the rows are records that read as before.
// COUNTER: RecordPlansEvicted >= 1
// COUNTER: RecordPlansTried <= 302
// COUNTER: PeakRecordPlansCached <= 301
// COUNTER: ObjectsParsedIntoRecords >= 3004
// COUNTER: ObjectsParsedIntoOrdinaryObjects <= 0
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number }
function orderNumbered(index: number): string[] {
  const left = ["a", "b", "c", "d", "e", "f", "g", "h"], order: string[] = [];
  for (let n = left.length; n > 0; n--) { order.push(left.splice(index % n, 1)[0]!); index = Math.floor(index / n); }
  return order;
}
function rowIn(order: string[], from: number): string { return "{" + order.map((name, i) => '"' + name + '":' + (from + i)).join() + "}"; }
function read(rows: Wide[]): string { let sum = 0; for (const row of rows) sum += (row.a ?? 0) * 3 + (row.h ?? 0); return sum + " " + Object.keys(rows[0]!).join(""); }
const first = orderNumbered(Number(process.argv[2] ?? 4321));
const said: string[] = [read(JSON.parse("[" + rowIn(first, 1) + "," + rowIn(first, 2) + "]"))];
let text = "[";
for (let i = 0; i < 300; i++) text += (i ? "," : "") + rowIn(orderNumbered(i), i);
text += "]";
for (let round = 0; round < 10; round++) {
  said.push(read(JSON.parse(text)));
  Bun.gc(true);
}
said.push(read(JSON.parse("[" + rowIn(first, 1) + "," + rowIn(first, 2) + "]")));
console.log("SAID " + said.join(" | "));
export {};
