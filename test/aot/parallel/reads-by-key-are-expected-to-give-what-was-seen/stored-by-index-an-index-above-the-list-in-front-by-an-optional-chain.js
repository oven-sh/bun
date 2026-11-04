// stored-by-index; unseen code: an-index-above-the-list, in-front of the loop; read by-an-optional-chain
const items = [];
for (let i = 0; i < 8; i++) items[i] = { price: i + 1, count: i & 3 };
globalThis.kept = items;
(0, eval)('delete kept[3]; Object.setPrototypeOf(kept, Object.create(Array.prototype, { 3: { value: { price: 19, count: 1 } } }))');
const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));
