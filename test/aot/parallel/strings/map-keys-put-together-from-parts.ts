interface Item {
  id: number;
  name: string;
}

const items: Item[] = [];
for (let i = 0; i < 40; i++) items.push({ id: i * 7919, name: i % 5 ? "n" + i : "" });
items.push({ id: 2147483647, name: "last" }, { id: -12, name: "below" }, { id: 0, name: "0" }, { id: 255, name: "12" }, { id: 256, name: "é" }, { id: 70000, name: "日本" });
items.push({ id: 1.5, name: "" }, { id: -0, name: "" }, { id: NaN, name: "" }, { id: 4294967296, name: "" }, { id: 2147483648, name: "" }, { id: -2147483648, name: "" }, { id: 1e21, name: "" }, { id: Infinity, name: "" });
for (let i = 0; i < 300; i++) items.push({ id: 65536 * (i % 7) + 300 + (i % 11), name: i % 3 ? "" : "r" + (i % 4) });

function suffixOf(item: Item): string {
  return item.name ? "@" + item.name : "";
}

const byId = new Map<string, number>();
const byName = new Map<string, number>();
const byPair = new Map<string, number>();
const lines: string[] = [];

for (let round = 0; round < 3; round++) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const other = items[(i * 3 + round) % items.length];
    const idKey = item.id + suffixOf(other);
    const nameKey = item.name + suffixOf(items[0]);
    const frontKey = suffixOf(items[0]) + item.name + suffixOf(items[5]);
    const pairKey = `${item.id},${other.id}`;
    const digitsKey = "" + item.id + other.id;
    byId.set(idKey, (byId.get(idKey) ?? 0) + 1);
    byName.set(nameKey, (byName.get(nameKey) ?? 0) + 1);
    byName.set(frontKey, (byName.get(frontKey) ?? 0) + 1);
    byPair.set(pairKey, (byPair.get(pairKey) ?? 0) + 1);
    byPair.set(digitsKey, (byPair.get(digitsKey) ?? 0) + 1);
    if (nameKey !== item.name || frontKey !== item.name) lines.push("a part alone gave another text: " + i);
    if (byId.get(String(item.id) + suffixOf(other)) !== byId.get(idKey)) lines.push("two ways to one key differ: " + i);
  }
}

function show(name: string, map: Map<string, number>) {
  let sum = 0;
  let text = "";
  for (const [key, count] of map) {
    sum += count;
    if (text.length < 400) text += key + "=" + count + " ";
  }
  console.log(name, map.size, sum, text);
}
show("byId", byId);
show("byName", byName);
show("byPair", byPair);
console.log(byId.get("0"), byId.get("2147483647"), byId.get("-12"), byId.get("255"), byId.has("00"), byId.has("07919"));
console.log(byId.get("1.5"), byId.get("NaN"), byId.get("4294967296"), byId.get("2147483648"), byId.get("-2147483648"), byId.get("1e+21"), byId.get("Infinity"), byId.has("-0"), byId.get("300"), byId.get("65836"), byId.get("393526"));
console.log(byName.get(""), byName.get("12"), byName.get("0"), byName.get("é"), byName.get("日本"));

const record: Record<string, number> = {};
const list: number[] = [10, 20, 30];
for (let i = 0; i < 3; i++) {
  const key = i + suffixOf(items[0]);
  record[key] = i;
  console.log(key, typeof key, key.length, list[key as unknown as number], record[key], key === String(i));
}
console.log(JSON.stringify(record), lines.length, lines.join("|"));
