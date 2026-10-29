// A field that holds a number, undefined or null is read where the reader wants a value of any kind: whole numbers, fractions, -0, NaN, the infinities and both empty values come out as they went in.
interface Reading { value: number | undefined | null; scale?: number }

function read(reading: Reading): unknown {
  return reading.value;
}
function readScale(reading: Reading): unknown {
  return reading.scale;
}
function show(value: unknown): string {
  return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) + ":number" : String(value) + ":" + typeof value;
}

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
function numberOfWords(high: number, low: number): number {
  words[1] = high;
  words[0] = low;
  return bits[0];
}

const values: (number | undefined | null)[] = [
  0, -0, 1, -1, 0.5, -0.5, 1.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e21, 5e-324, 1.7976931348623157e308,
  Infinity, -Infinity, NaN, -NaN, 0 / 0, undefined, null,
  // Other ways to write "not a number".
  numberOfWords(0x7ff80000, 0), numberOfWords(0x7ffa0000, 0), numberOfWords(0x7ffb0000, 0), numberOfWords(0x7ffc0000, 0), numberOfWords(0x7ffa0000, 1),
  numberOfWords(0x7fffffff, 0xffffffff), numberOfWords(0xfff80000, 0), numberOfWords(0xfffa0000, 0), numberOfWords(0xffffffff, 0xffffffff), numberOfWords(0x7ff00000, 1),
];

const readings: Reading[] = [];
for (const value of values) readings.push({ value });
for (const value of values) readings.push(value == null ? { value } : { value, scale: value });

const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  for (const reading of readings) lines.push(show(read(reading)) + " " + show(readScale(reading)));
}
console.log(lines.slice(0, readings.length).join("\n"));
console.log(lines.length, new Set(lines).size);

const one: Reading = { value: 1 };
for (const value of values) {
  one.value = value;
  one.scale = value ?? undefined;
  console.log(show(read(one)), show(readScale(one)), JSON.stringify(one));
}
