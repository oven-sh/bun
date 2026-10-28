interface Line { sku: string; count: number; price: number | null }
interface Order { id: number; lines: Line[]; note?: string }

const write = (order: Order): string => JSON.stringify(order);
const orders: Order[] = [
  { id: 1, lines: [{ sku: "a", count: 2, price: 2.5 }, { sku: "b", count: 1, price: null }] },
  { id: 2, lines: [], note: "empty" },
  { id: 3, lines: [{ sku: "c\n", count: -0, price: 1e21 }], note: "" },
];
let length = 0;
for (let round = 0; round < 3; round++) for (const order of orders) length += write(order).length;
console.log("orders", length, orders.map(write).join(" "));
