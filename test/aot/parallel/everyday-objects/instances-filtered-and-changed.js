// Instances filtered, changed through the filtered list, and removed from the first
class Order {
  constructor(id, total) {
    this.id = id;
    this.total = total;
    this.paid = false;
  }
}
function settle(totals, limit) {
  const orders = totals.map((total, i) => new Order(i, total));
  const small = orders.filter(order => order.total <= limit);
  for (const order of small) {
    order.paid = true;
    order.total = 0;
  }
  for (let i = orders.length - 1; i >= 0; i--) if (orders[i].paid) orders.splice(i, 1);
  return small.length + " " + orders.map(order => order.id + ":" + order.total).join() + " " + small.every(order => order.total === 0);
}
console.log(settle([5, 50, 7], 10));
console.log(settle([100, 200], 10));
console.log(settle([1, 1, 1], 1));
