// A number that is whole may be kept as a double: the result of a division, a product, Math.floor, a field declared `number`. Every way of printing it gives the digits of the integer: JSON.stringify with and without indentation, replacer and toJSON, String, a template, concatenation, join, a property key. Negative zero, the ends of the 32-bit range and what lies just outside them print as the language says
function half(x: number): number {
  return x / 2;
}
interface Row { id: number; size: number; ratio: number; tags: number[] }
function makeRow(i: number): Row {
  return { id: half(i * 2), size: Math.floor(i * 1.5) * 2, ratio: i / 4, tags: [half(i * 4), i * 0.5, half(i)] };
}

const lines: string[] = [];
const values: number[] = [
  half(6), half(-6), half(0), -half(0), half(1), half(4294967294), half(4294967296), half(-4294967296), half(-4294967298), half(2 ** 53), 1e21, half(2e21), 1e-7, 0.1 + 0.2, half(200) / 100,
  NaN, Infinity, -Infinity, Math.floor(7.9), Math.round(-7.5), Math.sqrt(81), 2 ** 10, 5 % 3, 10 * 0.1,
];
for (const value of values) {
  const holder: Record<string, number> = {};
  holder[value as unknown as string] = 1;
  lines.push(
    [String(value), `${value}`, value + "", [value].join(), [value, value].join("|"), value.toString(), JSON.stringify(value), JSON.stringify([value]), JSON.stringify({ v: value }), JSON.stringify({ v: value }, null, 1).replace(/\s+/g, " "),
      JSON.stringify({ v: value }, (key, inner) => inner), Object.keys(holder)[0], Object.is(value, -0) ? "negative zero" : "-"].join(" ; "),
  );
}

const rows: Row[] = [];
for (let i = 0; i < 40; i++) rows.push(makeRow(i));
lines.push(JSON.stringify(rows));
lines.push(JSON.stringify(rows.slice(0, 3), null, 2));
lines.push(JSON.stringify({ toJSON() { return half(84); } }));
lines.push(JSON.stringify(new Map([[half(2), half(4)]]).get(1)));
lines.push(JSON.stringify(Float64Array.of(half(2), half(3), -half(0))));
lines.push(JSON.stringify({ wide: "☃", n: half(10), list: [half(12), "☃", half(13)] }));
let sum = "";
for (let i = 0; i < 300; i++) sum += half(i * 2) + ",";
lines.push(sum);

console.log(lines.join("\n"));
