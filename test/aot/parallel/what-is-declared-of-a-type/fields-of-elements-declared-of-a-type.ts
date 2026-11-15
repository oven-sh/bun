type Entry = { price: number; count: number; label: string };
const entries: Entry[] = [];
for (let i = 0; i < 16; i++) entries.push({ price: i, count: i & 3, label: "e" + i });
(entries as any)[5] = { extra: 1, count: 0, price: 5, label: "five" };
(entries as any)[9] = { label: 9, price: "9", count: 2n, other: true };
(entries as any)[11] = { price: 1.5, count: -0, label: "" };
(globalThis as any).entries = entries;
(0, eval)("1");
const bound = Number((globalThis as any).process?.argv?.[2] ?? 12);
const said: string[] = [];
for (let round = 0; round < bound; round++) {
  let text = "";
  for (let i = 0; i < entries.length; i++) {
    let product: unknown;
    try { product = entries[i].price * entries[i].count; } catch (error) { product = (error as Error).name; }
    text += String(product) + ":" + String(entries[i].label).length + " ";
  }
  if (round === 0 || round === bound - 1) said.push(text);
}
console.log(said.join("\n"));
