const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
interface Line { sku: string; quantity: number; lineCents: number }
interface Receipt { orderId: string; lines: Line[]; subtotalCents: number; discountCents: number; totalCents: number; paid: boolean; note?: string }
function receipt(count: number): Receipt {
  const lines: Line[] = [];
  for (let n = 0; n < count; n++) lines.push({ sku: "SKU-" + (1000 + 37 * n), quantity: 1 + ((2 * n) % 5), lineCents: (199 + 350 * n) * (1 + ((2 * n) % 5)) });
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  return { orderId: "o-" + count, lines, subtotalCents, discountCents: Math.round(subtotalCents / 10), totalCents: subtotalCents - Math.round(subtotalCents / 10), paid: count % 2 === 0 };
}
const value: any = leak(receipt(10));
console.log(JSON.stringify(value));
console.log(JSON.stringify(value, null, 2));
console.log(JSON.stringify(value, null, "\t|"));
console.log(JSON.stringify(value, ["orderId", "lines", "sku", "paid"]));
console.log(JSON.stringify(value, (key, held) => (key === "quantity" ? undefined : typeof held === "number" ? held + 1 : held)));
console.log(await Response.json(value).text());
console.log(await new Response(JSON.stringify(value)).json().then((again: any) => JSON.stringify(again) === JSON.stringify(value)));
console.log(JSON.stringify({ wrapped: value, list: [value, value] }).length);
console.log(JSON.stringify([value.lines, value.lines[3], value.lines.slice(2, 4)]));
console.log(Bun.inspect(value).length > 0, structuredClone(value).lines.length, JSON.stringify(structuredClone(value)) === JSON.stringify(value));
let total = 0;
for (let round = 0; round < 3000; round++) {
  const made: any = leak(receipt(round % 23));
  total += JSON.stringify(made).length;
  if (round % 500 === 0) Bun.gc(true);
}
console.log(total);
export {};
