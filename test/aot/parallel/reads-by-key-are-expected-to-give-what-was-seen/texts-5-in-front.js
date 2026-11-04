// texts; unseen code: kept[3] = null, in-front of the loop
const items = [];
for (let i = 0; i < 8; i++) items.push('t' + i);
globalThis.kept = items;
(0, eval)('kept[3] = null');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i].length;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
