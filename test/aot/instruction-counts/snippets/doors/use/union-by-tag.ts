// reads a field of a union after a test of its tag
const operations = 64;
const orders: Order[] = [];
for (let i = 0; i < operations; i++) orders.push(door(i));
let sum = 0;

kernel: {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    sum += order.shape.kind === "circle" ? order.shape.radius : order.shape.side;
  }
}

console.log(sum);
