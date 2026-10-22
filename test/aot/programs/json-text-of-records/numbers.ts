const leak = new Function("value", process.argv.length > 99 ? "" : "return value");
function text(value: unknown, indent?: number): string {
  return JSON.stringify(leak(value), null, indent);
}
interface Numbers { whole: number; optional?: number; nullable: number | null; either: number | undefined; small: number; fraction: number }
function make(whole: number, optional: number | undefined, nullable: number | null, either: number | undefined, small: number, fraction: number): Numbers {
  return optional === undefined ? { whole, nullable, either, small, fraction } : { whole, optional, nullable, either, small, fraction };
}
const edges = [0, -0, 1, 9, 10, 11, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 10001, 99999, 100000, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 100000001,
  2147483647, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e300, -1, -9, -10, -99, -100, -9999, -10000, -99999999, -100000000, -2147483648, -2147483649,
  0.5, -0.5, 1.5, 9999.5, 10000.25, 0.1, 1e-7, 5e-324, 1.7976931348623157e308, NaN, Infinity, -Infinity];
for (let round = 0; round < 3; round++) {
  const rows: Numbers[] = [];
  for (const edge of edges) {
    const row = make(edge, round ? edge : undefined, round === 1 ? null : edge, round === 2 ? undefined : edge, edge | 0, edge + 0.5);
    rows.push(row);
    console.log(text(row));
  }
  console.log(text(rows));
  console.log(text(rows.slice(0, 3), 2));
}
let sum = 0;
for (let n = 0; n < 120000; n += 7) {
  const written = text({ n, twice: n * 2, half: n / 2, minus: -n });
  if (written !== `{"n":${n},"twice":${n * 2},"half":${n / 2},"minus":${n ? -n : 0}}`) console.log("differs", n, written);
  sum += written.length;
}
for (let n = 99990000; n < 100010000; n += 3) {
  const written = text({ n });
  if (written !== `{"n":${n}}`) console.log("differs", n, written);
  sum += written.length;
}
console.log(sum);
export {};
