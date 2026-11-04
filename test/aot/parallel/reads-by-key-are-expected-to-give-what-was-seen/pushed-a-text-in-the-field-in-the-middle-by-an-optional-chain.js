// pushed; unseen code: a-text-in-the-field, in-the-middle of the loop; read by-an-optional-chain
const items = [];
for (let i = 0; i < 8; i++) items.push({ price: i + 1, count: i & 3 });
globalThis.kept = items;
const seen = [];
try {
  for (let i = 0; i < items.length; i++) {
    if (i === 1) (0, eval)("kept[3].price = 'text'");
    seen.push(String(items[i]?.price), typeof items[i]?.count);
  }
} catch (error) { console.log(error.constructor.name, error.message.length > 0); }
console.log(seen.join(" "));
