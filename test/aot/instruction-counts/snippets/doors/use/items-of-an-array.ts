// goes through the four objects in an array field of an object
const operations = 64;
const orders: Order[] = [];
for (let i = 0; i < operations; i++) orders.push(door(i));
let sum = 0;

kernel: {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    for (const item of order.items) sum += item.quantity + item.sku.length;
  }
}

console.log(sum);
