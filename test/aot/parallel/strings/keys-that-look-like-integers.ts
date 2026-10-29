function spell(parts: (string | number)[]): string {
  return parts.map(part => String(part)).join("").split("").join("");
}

function joinIds(ids: number[]): string {
  let result = "";
  for (let i = 0; i < ids.length; i++) {
    if (result.length) result += ",";
    result += ids[i];
  }
  return result;
}

function joinTexts(texts: string[]): string {
  let result = "";
  for (const text of texts) result += text;
  return result;
}

function pairKey(a: number, b: number, suffix: string): string {
  return `${a},${b}${suffix}`;
}

function tripleKey(a: number, separator: string, b: number): string {
  return a + separator + b;
}

const table = new Map<string, string>();
const list: string[] = [];
list[7] = "seven";
list[10] = "ten";
list[12345678] = "eight digits";

function describe(key: string, expected: string): string {
  const spelled = spell([expected]);
  table.set(spelled, "stored " + expected);
  const indexed = (list as unknown as Record<string, string | undefined>)[key];
  return [JSON.stringify(key), key === spelled, key.length, table.get(key), table.has(key + " "), indexed, String(Number(key))].join(" | ");
}

const numbers = [0, 1, 7, 9, 10, 99, 100, 255, 256, 257, 65535, 999999, 1000000, 9999999, 10000000, 12345678, 99999999, 100000000, 100000001, 999999999, 1000000000, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9999999999];
for (const number of numbers) {
  console.log("one id:", describe(joinIds([number]), String(number)));
  console.log("by parts:", describe(tripleKey(number, "", 0).slice(0, -1), String(number)));
}
for (let round = 0; round < 3; round++) {
  for (const number of numbers) {
    if (joinIds([number]) !== String(number)) console.log("differs", number);
    if (table.get(joinIds([number])) !== "stored " + number) console.log("not found", number);
  }
}

const texts = [["0", "0"], ["0", "7"], ["00", "7"], ["1", "0"], ["1", "", "0"], ["12", "/"], ["12", ":"], ["/", "12"], [":", "12"], ["1", ",", "2"], ["1", " "], [" ", "1"], ["1", "a"], ["1", "°"], ["±", "1"], ["1", "ÿ", "1"], ["-", "1"], ["1", "e", "3"], ["1234", "5678"], ["1234", "56789"], ["12345", "67890"], ["12345", "678901"], ["4294", "967295"], ["0123", "4567"], ["1", "٠"]];
for (const parts of texts) {
  console.log("texts:", describe(joinTexts(parts), parts.join("")));
}

for (const [a, b] of [[0, 0], [1, 2], [-1, 2], [1, -2], [99999999, 100000000], [100000000, 99999999], [2147483647, -2147483648], [12, 345678], [1.5, 2], [1, 2.5], [1e21, 1], [-0, 0], [NaN, 1]]) {
  for (const suffix of ["", ":1", ":", "é", "一", "x".repeat(50), "x".repeat(70)]) {
    console.log("pair:", describe(pairKey(a, b, suffix), a + "," + b + suffix));
  }
  for (const separator of ["", ",", "0", "-", "·", "一"]) {
    console.log("triple:", describe(tripleKey(a, separator, b), String(a) + separator + String(b)));
  }
}

let found = 0;
const pairs = new Map<string, number>();
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 40000; i++) {
    const key = pairKey(i * 31, i % 977, i % 5 ? "" : ":" + (i % 3));
    const former = pairs.get(key);
    if (former === undefined) pairs.set(key, i);
    else if (former === i) found++;
    const other = tripleKey(i, ",", i * 7);
    if (other !== spell([i, ",", i * 7]) && found >= 0) found = -1000000;
  }
}
console.log("pairs:", pairs.size, found);
