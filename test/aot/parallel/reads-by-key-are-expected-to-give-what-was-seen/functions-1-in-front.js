// functions; unseen code: kept[3] = Math.abs, in-front of the loop
const items = [];
for (let i = 0; i < 8; i++) items.push(x => x + i);
globalThis.kept = items;
(0, eval)('kept[3] = Math.abs');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i](1);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
