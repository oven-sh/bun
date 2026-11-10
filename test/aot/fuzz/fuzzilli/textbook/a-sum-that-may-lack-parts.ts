interface Order {
  price: number;
  tip?: number;
  discount?: { percent: number };
}
function due(order: Order): number {
  const off = order.discount?.percent ?? 0;
  return order.price * (1 - off / 100) + (order.tip ?? 0);
}
const orders: Order[] = [{ price: 10 }, { price: 20, tip: 3 }, { price: 50, discount: { percent: 10 } }];
console.log(orders.map(due).join());
