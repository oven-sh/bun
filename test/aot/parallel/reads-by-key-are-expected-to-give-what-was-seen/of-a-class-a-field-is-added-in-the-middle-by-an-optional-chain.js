// of-a-class; unseen code: a-field-is-added, in-the-middle of the loop; read by-an-optional-chain
const items = [];
class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }
for (let i = 0; i < 8; i++) items.push(new Item(i));
globalThis.kept = items;
const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    if (i === 1) (0, eval)('kept[3].extra = 1; kept[4].other = 2');
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));
