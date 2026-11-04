// numbers; unseen code: kept[3] = 2 ** 40, in-front of the loop
const items = [];
for (let i = 0; i < 8; i++) items.push(i + 1);
globalThis.kept = items;
(0, eval)('kept[3] = 2 ** 40');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i] * 2;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
