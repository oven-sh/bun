// unshifted; unseen code: a-proxy, in-the-middle of the loop; read at-the-top
const items = [];
for (let i = 0; i < 8; i++) items.unshift({ price: i + 1, count: i & 3 });
globalThis.kept = items;
let total = 0;
try {
  for (let i = 0; i < items.length; i++) {
    if (i === 1) (0, eval)("kept[3] = new Proxy({ price: 1, count: 1 }, { get(target, key) { return key === 'price' ? 13 : target[key]; } })");
    total += items[i].price * items[i].count;
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(typeof total, String(total));
