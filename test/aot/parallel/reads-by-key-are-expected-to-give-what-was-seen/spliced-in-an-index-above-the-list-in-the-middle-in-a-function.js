// spliced-in; unseen code: an-index-above-the-list, in-the-middle of the loop; read in-a-function
const items = [];
for (let i = 0; i < 8; i++) items.splice(i, 0, { price: i + 1, count: i & 3 });
globalThis.kept = items;
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 1) (0, eval)('delete kept[3]; Object.setPrototypeOf(kept, Object.create(Array.prototype, { 3: { value: { price: 19, count: 1 } } }))');
    total += list[i].price * list[i].count;
  }
  return total;
}
try { const total = sum(items); console.log(typeof total, String(total)); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }
