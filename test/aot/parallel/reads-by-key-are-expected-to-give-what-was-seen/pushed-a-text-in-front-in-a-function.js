// pushed; unseen code: a-text, in-front of the loop; read in-a-function
const items = [];
for (let i = 0; i < 8; i++) items.push({ price: i + 1, count: i & 3 });
globalThis.kept = items;
(0, eval)("kept[3] = 'text'");
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total += list[i].price * list[i].count;
  }
  return total;
}
try { const total = sum(items); console.log(typeof total, String(total)); } catch (error) { console.log(error.constructor.name, error.message.length > 0); }
