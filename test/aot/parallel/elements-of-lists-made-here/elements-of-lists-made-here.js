const bound = Number(globalThis.process?.argv?.[2] ?? 12);
const said = [];
function sum(list) { let total = 0; for (let round = 0; round < bound; round++) for (let i = 0; i < list.length; i++) total += list[i].price * list[i].count; return total; }
function pushed() {
  const items = [];
  for (let i = 0; i < 16; i++) items.push({ price: i, count: i & 3 });
  globalThis.kept = items;
  (0, eval)("globalThis.kept[3] = { count: 2, price: 100, more: 1 }; globalThis.kept[5] = { price: '7', count: 3 }; globalThis.kept[7] = { get price() { return 9; }, count: 1 }; delete globalThis.kept[9].count; globalThis.kept[11] = Object.create({ price: 4, count: 4 });");
  let total = 0;
  for (let round = 0; round < bound; round++) for (let i = 0; i < items.length; i++) total += items[i].price * items[i].count;
  return total;
}
function written() {
  const items = [{ price: 1, count: 2 }, { price: 3.5, count: -0 }, { count: 4, price: 5 }];
  globalThis.kept = items;
  (0, eval)("globalThis.kept.push({ price: 2n, count: 3n })");
  const seen = [];
  for (let round = 0; round < bound; round++) for (let i = 0; i < items.length; i++) { const product = items[i].price * items[i].count; if (round === bound - 1) seen.push(typeof product + ":" + String(product)); }
  return seen.join();
}
function stored() {
  const items = [];
  for (let i = 0; i < 6; i++) items[i] = { price: "p" + i, count: i };
  items[2] = { extra: true, price: "q", count: 9 };
  globalThis.kept = items;
  (0, eval)("globalThis.kept[4] = null; globalThis.kept.length = 8;");
  let text = "";
  for (let round = 0; round < bound; round++) for (let i = 0; i < items.length; i++) { try { text = text.slice(-40) + items[i].price + items[i].count; } catch (error) { text += error.constructor.name; } }
  return text;
}
function holes() {
  const items = [];
  for (let i = 0; i < 4; i++) items.push({ price: i, count: 1 });
  globalThis.kept = items;
  (0, eval)("Object.defineProperty(globalThis.kept, 1, { get() { return { price: 50, count: 2 }; } }); Object.freeze(globalThis.kept[2]); globalThis.kept[3].price = undefined;");
  let total = 0;
  for (let round = 0; round < bound; round++) for (let i = 0; i < items.length; i++) total += items[i].price * items[i].count;
  return total;
}
for (const run of [pushed, written, stored, holes]) said.push(run.name + " " + run());
said.push("handed " + sum([{ price: 2, count: 3 }, { price: 4, count: 5 }]));
console.log(said.join("\n"));
