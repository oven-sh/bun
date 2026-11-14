// A bound that arrives boxed is unboxed before the outer loop. Tests narrow it, and the inner loops compare with what they leave.
const bytes = new Uint8Array(48);
for (let i = 0; i < bytes.length; i++) bytes[i] = i % 5 === 0 ? i + 1 : 0;
function skip(n: any): string {
  let p = 0, s = 0, words = 0;
  while (p < n) {
    s += bytes[p] ?? 1000;
    p++;
    while (p < n && bytes[p] === 0) p++;
    words++;
  }
  return p + "/" + s + "/" + words;
}
function down(from: any, to: any): string {
  let k = from, s = 0;
  while (k >= to) {
    s += k * 2;
    k--;
    while (k > to && k % 3 !== 0) k--;
  }
  return k + "/" + s;
}
function between(x: any, low: any, high: any): string {
  let out = "";
  for (let i = 0; i < 6; i++) if (x >= low && x < high) { out += x - low + ","; if (x > low) out += high - x + ";"; x = x + 1; }
  return out;
}
const calls: string[] = [];
const loud = (value: number) => ({ valueOf() { calls.push("v" + value); return value; } });
for (const n of [0, 1, 2, 5, 6, 47, 48, 49, 3.5, -1, "12", null, undefined, NaN, true, loud(4), -0]) console.log(String(typeof n), skip(n));
for (const [from, to] of [[9, 0], [9.5, 0], [4, 4], ["7", 2], [3, "1"], [0, -0], [5, loud(3)], [2 ** 31, 2 ** 31 - 4], [-3, -9]] as any[]) console.log(down(from, to));
for (const [x, low, high] of [[1, 0, 4], [2.5, 1, 5], ["3", 2, 9], [0, 0, 0], [2 ** 31 - 2, 0, 2 ** 31 + 2], [-5, -6, -1], [1, undefined, 3], [null, -1, 2], [4, loud(3), loud(7)]] as any[]) console.log(between(x, low, high));
console.log(calls.length, calls.slice(0, 6).join());
