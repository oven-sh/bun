const bound = Number(globalThis.process?.argv?.[2] ?? 12);
const said = [];
function stored() {
  const items = [];
  for (let i = 0; i < 16; i++) items.push({ price: i, count: i & 3 });
  items[4] = { extra: 1, count: 0, price: 40 };
  items[6] = { price: "six", count: 2 };
  items[8] = { count: 3n, price: 2n };
  globalThis.kept = items;
  (0, eval)("globalThis.kept[2] = { price: 1.5, count: -0, more: [] }; globalThis.kept[10] = undefined;");
  const seen = [];
  for (let round = 0; round < bound; round++) for (let i = 0; i < items.length; i++) {
    let product;
    try { product = items[i].price * items[i].count; } catch (error) { product = error.constructor.name; }
    if (round === bound - 1) seen.push(typeof product + ":" + String(product));
  }
  return seen.join();
}
function written() {
  const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { y: 5, x: 6 }, { x: 7, y: 8, z: 9 }];
  globalThis.kept = points;
  (0, eval)("globalThis.kept[1].x = 'text'; delete globalThis.kept[2].y; Object.defineProperty(globalThis.kept[3], 'x', { get() { return 70; } });");
  let text = "";
  for (let i = 0; i < bound * 4; i++) text = (text + "," + points[i & 3].x * points[i & 3].y).slice(-60);
  return text;
}
function mixed() {
  const rows = [{ name: "a", size: 1 }, { name: null, size: 2.5 }, { name: undefined, size: -1 }, { name: true, size: 1e300 }];
  globalThis.kept = rows;
  (0, eval)("1");
  let text = "";
  for (let i = 0; i < bound * 4; i++) text = (text + String(rows[i & 3].name) + rows[i & 3].size * 2).slice(-70);
  return text;
}
function nested() {
  const table = [[{ v: 1 }, { v: 2 }], [{ v: 3 }, { v: "4" }]];
  globalThis.kept = table;
  (0, eval)("globalThis.kept[0][1] = { v: { valueOf() { return 20; } } }");
  let sum = 0;
  for (let i = 0; i < bound * 4; i++) sum += table[i & 1][(i >> 1) & 1].v * 2;
  return sum;
}
function holes() {
  const list = [{ w: 1 }, , { w: 3 }];
  globalThis.kept = list;
  (0, eval)("1");
  let text = "";
  for (let i = 0; i < bound * 3; i++) { try { text = (text + list[i % 3].w * 2).slice(-30); } catch (error) { text += error.constructor.name[0]; } }
  return text;
}
for (const run of [stored, written, mixed, nested, holes]) said.push(run.name + " " + run());
console.log(said.join("\n"));
