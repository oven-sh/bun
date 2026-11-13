// Every row spells the same eight names in an order of its own, so there are as many plans of records as rows. The parser finds the plan of a row by the hash of its names.
// Sizes: 250 1000 4000
// Passes: 40
// Grows: linear
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number }
const size = Number(process.env.SIZE ?? 100),
  passes = Number(process.env.PASSES ?? 1);
function orderNumbered(index: number): string[] {
  const left = ["a", "b", "c", "d", "e", "f", "g", "h"],
    order: string[] = [];
  for (let n = left.length; n > 0; n--) {
    order.push(left.splice(index % n, 1)[0]!);
    index = Math.floor(index / n);
  }
  return order;
}
const texts: string[] = [];
for (let i = 0; i < size; i++) texts.push("{" + orderNumbered(i * 7).map((name, at) => '"' + name + '":' + at).join() + "}");
const text = "[" + texts.join() + "]";
function once(): number {
  const rows: Wide[] = JSON.parse(text);
  let sum = 0;
  for (const row of rows) sum += (row.a ?? 0) + (row.h ?? 0);
  return sum + rows.length;
}
let told = 0;
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
