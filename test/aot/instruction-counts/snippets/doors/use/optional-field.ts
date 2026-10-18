// reads an optional field that every other object has
const operations = 64;
const orders: Order[] = [];
for (let i = 0; i < operations; i++) orders.push(door(i));
let sum = 0;

kernel: {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    sum += order.note === undefined ? 0 : order.note.length;
  }
}

console.log(sum);
