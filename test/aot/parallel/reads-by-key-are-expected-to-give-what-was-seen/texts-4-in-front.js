// texts; unseen code: delete kept[3], in-front of the loop
const items = [];
for (let i = 0; i < 8; i++) items.push('t' + i);
globalThis.kept = items;
(0, eval)('delete kept[3]');
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    total += items[i].length;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
