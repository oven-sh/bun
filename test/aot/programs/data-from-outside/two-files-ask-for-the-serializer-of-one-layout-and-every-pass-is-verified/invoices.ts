interface Row { sku: string; count: number; price: number | null }
interface Invoice { id: number; lines: Row[]; note?: string }

const write = (invoice: Invoice): string => JSON.stringify(invoice);
function total(invoice: Invoice): number {
  let sum = 0;
  for (const row of invoice.lines) sum += row.count * (row.price ?? 0);
  return sum;
}
const invoices: Invoice[] = [
  { id: 7, lines: [{ sku: "x", count: 3, price: 0.5 }], note: "paid" },
  { id: 8, lines: [{ sku: "y", count: 1, price: null }, { sku: "z", count: 4, price: 4 }] },
];
for (const invoice of invoices) console.log("invoice", total(invoice), write(invoice), write({ ...invoice, note: "copy" }).length);
