// functions; unseen code: delete kept[3], in-the-middle of the loop
const items = [];
for (let i = 0; i < 8; i++) items.push(x => x + i);
globalThis.kept = items;
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    if (i === 1) (0, eval)('delete kept[3]');
    total += items[i](1);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
