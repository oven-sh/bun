// spliced-in; unseen code: a-longer-list, in-the-middle of the loop; read at-the-top
const items = [];
for (let i = 0; i < 8; i++) items.splice(i, 0, { price: i + 1, count: i & 3 });
globalThis.kept = items;
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    if (i === 1) (0, eval)("kept.push({ price: 'p', count: 2 }, 4, { count: 1 })");
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
