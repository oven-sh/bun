// of-a-class; unseen code: a-fraction-in-the-field, in-front of the loop; read in-a-function
const items = [];
class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }
for (let i = 0; i < 8; i++) items.push(new Item(i));
globalThis.kept = items;
(0, eval)('kept[3].price = 0.5');
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i].price * list[i].count;
  }
  return total;
}
try { const total = sum(items); console.log(typeof total, String(total)); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }
