// of-a-class; unseen code: a-field-is-added, in-front of the loop; read at-the-top
const items = [];
class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }
for (let i = 0; i < 8; i++) items.push(new Item(i));
globalThis.kept = items;
(0, eval)('kept[3].extra = 1; kept[4].other = 2');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
