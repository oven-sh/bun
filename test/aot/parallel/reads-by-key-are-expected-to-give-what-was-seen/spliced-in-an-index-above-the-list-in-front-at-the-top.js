// spliced-in; unseen code: an-index-above-the-list, in-front of the loop; read at-the-top
const items = [];
for (let i = 0; i < 8; i++) items.splice(i, 0, { price: i + 1, count: i & 3 });
globalThis.kept = items;
(0, eval)('delete kept[3]; Object.setPrototypeOf(kept, Object.create(Array.prototype, { 3: { value: { price: 19, count: 1 } } }))');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
