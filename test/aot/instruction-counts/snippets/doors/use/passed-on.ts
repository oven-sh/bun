// passes an object on through three functions, the last of which reads two fields
const operations = 64;
const orders: Order[] = [];
for (let i = 0; i < operations; i++) orders.push(door(i));
function third(order: Order): number {
  return order.id + order.tax;
}
function second(order: Order): number {
  return third(order) + 1;
}
function first(order: Order): number {
  return second(order) + 1;
}
let sum = 0;

kernel: {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    sum += first(order);
  }
}

console.log(sum);
