// of-a-class; unseen code: a-proxy, in-front of the loop; read by-an-optional-chain
const items = [];
class Item { constructor(i) { this.price = i + 1; this.count = i & 3; } }
for (let i = 0; i < 8; i++) items.push(new Item(i));
globalThis.kept = items;
(0, eval)("kept[3] = new Proxy({ price: 1, count: 1 }, { get(target, key) { return key === 'price' ? 13 : target[key]; } })");
const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));
