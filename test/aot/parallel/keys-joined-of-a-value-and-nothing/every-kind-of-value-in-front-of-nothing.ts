function suffix(of: { alias?: string }): string { return of.alias ? "@" + of.alias : ""; }
const plain = {};
const named = { alias: "a" };
const seen = new Map<string, number>();
function countNumber(value: number, of: { alias?: string }): string {
  const key = value + suffix(of);
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return key;
}
function countText(value: string, of: { alias?: string }): string {
  const key = value + suffix(of);
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return key;
}
function countEither(value: number | string, of: { alias?: string }): string {
  const key = value + suffix(of);
  seen.set(key, (seen.get(key) ?? 0) + 1);
  return key;
}
const rope = "left-" + String(Date.length) + "-right".repeat(3);
const numbers = [0, -0, 1, 63, 64, 65, 320, 576, 65600, 131136, 99999, 2147483647, -1, -63, -64, -2147483648, 2147483648, 4294967295, 4294967360, 0.5, -0.5, 64.5, 1e21, NaN, Infinity, -Infinity];
const texts = ["", "x", "64", "-64", rope, rope + rope, "é", "世界", "0", "00"];
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  for (const of of [plain, named]) {
    for (const value of numbers) {
      const key = countNumber(value, of);
      const other = countEither(value, of);
      if (round === 2) out.push(typeof key + ":" + key + ":" + key.length + ":" + (key === other) + ":" + seen.get(key));
    }
    for (const value of texts) {
      const key = countText(value, of);
      const other = countEither(value, of);
      if (round === 2) out.push(typeof key + ":" + key + ":" + key.length + ":" + (key === other) + ":" + seen.get(key));
    }
  }
}
console.log(out.join("\n"));
console.log(seen.size);
