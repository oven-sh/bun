// stored-by-index; unseen code: frozen, in-front of the loop; read at-the-top
const items = [];
for (let i = 0; i < 8; i++) items[i] = { price: i + 1, count: i & 3 };
globalThis.kept = items;
(0, eval)('Object.freeze(kept); Object.freeze(kept[3])');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
