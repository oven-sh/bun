// reads three fields of an object
const operations = 64;
const orders: Order[] = [];
for (let i = 0; i < operations; i++) orders.push(door(i));
let sum = 0;

kernel: {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    sum += order.id + order.name.length + (order.paid ? 1 : 0);
  }
}

console.log(sum);
