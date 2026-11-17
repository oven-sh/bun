const mixed: any[] = JSON.parse("[3, -1, 7, 2147483647, -2147483648, 0, 12, 4.5, null, 40]");
const table: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => (k * 37) % 101).join() + "]");
const words = new Int32Array(64).map((_, k) => Math.imul(k, 0x9e3779b1));
const unsignedWords = new Uint32Array(words);
let kept: any = null;
function keep(value: any) {
  kept = value;
  return value;
}
function readBoth(values: any[]) {
  let line = "";
  for (const value of values) {
    if (typeof value === "number" && (value | 0) === value) {
      const low = value & 31, shifted = value << 2, half = value >> 1;
      line += `${low}:${shifted}:${half}:${value < 5 ? value : -value}:${value * 0.5}:${table[low]}:${table[value] ?? "-"}:${words[value & 63] + value} `;
      keep(value);
      line += (value ^ low) + (value > 6 ? value : low) + ",";
    } else keep([value]);
  }
  return line + String(kept);
}
function wideProducts(a: number, b: number) {
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const product = Math.imul(words[i], a) ^ words[(i + b) & 63];
    const low = unsignedWords[i] * 3;
    sum = (sum + (product >>> 0) + (product < 0 ? product : low) + (product & 63 ? table[product & 63] : 1) + low % 7) % 1000003;
    if (product === b) keep(product);
  }
  return sum;
}
function boxedCounters(limit: any) {
  let t = 0;
  for (let i: any = 0; i < limit; i++) {
    t = (t + table[i & 63] * i + (i << 3) + (i >>> 1)) % 1000003;
    if (t === 77) keep(i);
  }
  return t;
}
console.log(readBoth(mixed), readBoth(table.slice(0, 5)), wideProducts(3, 7), wideProducts(-5, 63), boxedCounters(50), boxedCounters(mixed[2]), String(kept));
