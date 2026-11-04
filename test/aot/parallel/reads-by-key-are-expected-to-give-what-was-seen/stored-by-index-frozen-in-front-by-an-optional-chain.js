// stored-by-index; unseen code: frozen, in-front of the loop; read by-an-optional-chain
const items = [];
for (let i = 0; i < 8; i++) items[i] = { price: i + 1, count: i & 3 };
globalThis.kept = items;
(0, eval)('Object.freeze(kept); Object.freeze(kept[3])');
const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));
