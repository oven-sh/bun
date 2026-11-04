// of-a-class; unseen code: a-getter-on-the-index, in-the-middle of the loop; read in-a-function
const items = [];
class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }
for (let i = 0; i < 8; i++) items.push(new Item(i));
globalThis.kept = items;
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === 1) (0, eval)('Object.defineProperty(kept, 3, { get() { return { price: 100, count: 1 }; } })');
    total += list[i].price * list[i].count;
  }
  return total;
}
try { const total = sum(items); console.log(typeof total, String(total)); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }
