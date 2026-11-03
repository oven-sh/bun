// JSON.stringify of objects whose type is known writes a field declared `number` by code made for the type. Most such numbers are whole and short; every other one has to come out as the language says: negative ones, negative zero, the first number with nine digits, what lies outside 32 and 53 bits, fractions, exponents, NaN and the infinities
interface Reading {
  id: number;
  value: number;
  label: string;
  ok: boolean;
  more?: number;
}
interface Page {
  total: number;
  readings: Reading[];
  raw: number[];
}

const values: number[] = [
  0, -0, 1, 9, 10, 42, 99, 100, 999, 1000, 9999, 10000, 65535, 99999, 100000, 1234567, 9999999, 10000000, 99999999, 100000000, 100000001, 2147483647, 2147483648, 4294967295, 4294967296,
  -1, -9, -10, -99999999, -100000000, -2147483648, -2147483649, 9007199254740991, 9007199254740992, -9007199254740991, 1e21, 1e20, 123456789012345680000, 0.5, -0.5, 0.1, 1.5, 99999999.5, 1e-7, 5e-324,
  1.7976931348623157e308, NaN, Infinity, -Infinity, 0.1 + 0.2, 100 / 3, 7 / 7, 1e3, 2 ** 26, 2 ** 27,
];

function makePage(scale: number): Page {
  const readings: Reading[] = [];
  for (let i = 0; i < values.length; i++) {
    const reading: Reading = { id: i * scale, value: values[i]! * scale, label: "r" + i, ok: i % 2 === 0 };
    if (i % 3 === 0) reading.more = values[values.length - 1 - i]!;
    readings.push(reading);
  }
  return { total: readings.length / scale, readings, raw: values.map((value) => value / scale) };
}

const lines: string[] = [];
for (const scale of [1, 2, 0.5, -1, 1000]) lines.push(JSON.stringify(makePage(scale)));
let length = 0;
for (let round = 0; round < 300; round++) length += JSON.stringify(makePage(1 + (round % 4))).length;
lines.push("length " + length);
lines.push(JSON.stringify({ id: -0, value: 1e8, label: "", ok: false } satisfies Reading));
console.log(lines.join("\n"));
