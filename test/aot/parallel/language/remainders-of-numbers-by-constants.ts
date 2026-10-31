const launder = new Function("value", "return value") as <V>(value: V) => V;

const numbers: number[] = [
  0, -0, 1, -1, 2, -2, 3, -3, 4, -4, 5, 6, 7, -7, 8, -8, 9, 10, -10, 15, 16, -16, 1023, 1024, -1024, 1025, 65535, 65536, 2147483646, 2147483647, 2147483648, 2147483649, -2147483647, -2147483648, -2147483649,
  4294967295, 4294967296, 4294967297, -4294967296, 1700000000123, -1700000000123, 2 ** 52, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 2 ** 62, 2 ** 63, -(2 ** 63), 2 ** 64, 1e21, -1e21, 1e300,
  0.5, -0.5, 1.5, -1.5, 2.5, 6.999999, 7.000001, 1023.5, 4294967296.5, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, NaN, Infinity, -Infinity,
];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return String(value);
}

let digest = 0;
let lines = 0;
function note(label: string, parts: unknown[]): void {
  const text = label + " " + parts.map(show).join(",");
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
  if (lines++ % 23 === 0) console.log(text);
}

function tested(x: number): void {
  note("=== 0", [x % 2 === 0, x % 3 === 0, x % 4 === 0, x % 7 === 0, x % 10 === 0, x % 1024 === 0, x % 1000 === 0, x % 2147483647 === 0, 0 === x % 5]);
  note("=== k", [x % 2 === 1, x % 2 === -1, x % 2 === 2, x % 3 === 2, x % 3 === -2, x % 4 === 3, x % 4 === -3, x % 4 === 4, x % 8 === -7, x % 10 === 9, x % 1024 === 1023, x % 1024 === -1023, 1 === x % 2]);
  note("!==", [x % 2 !== 0, x % 2 !== 1, x % 3 !== 0, x % 7 != 0, x % 7 == 3]);
  note("truth", [x % 2 ? 1 : 2, x % 3 ? 1 : 2, x % 7 ? 1 : 2, x % 1024 ? 1 : 2, !(x % 2), !!(x % 5), x % 2 && 7, x % 3 || 8]);
  let count = 0;
  if (x % 2 === 0) count += 1;
  if (x % 3 === 0) count += 2;
  if (x % 5) count += 4;
  while (x % 4 === 1 && count < 100) count += 100;
  note("branches", [count]);
}

function asNumbers(x: number): void {
  note("small", [x % 1, x % 2, x % 3, x % 4, x % 5, x % 7, x % 8, x % 10, x % 16, x % 100, x % 1000, x % 1024]);
  note("large", [x % 65536, x % 233280, x % 1000003, x % 2147483647, x % 2147483648, x % 4294967295, x % 4294967296, x % 4294967297, x % 1000000007, x % 1e12, x % 2 ** 52, x % (2 ** 53 - 1), x % 2 ** 53, x % 2 ** 54, x % 1e21]);
  note("other divisors", [x % -1, x % -2, x % -3, x % -1024, x % 0, x % -0, x % 0.5, x % 1.5, x % NaN, x % Infinity, x % -Infinity]);
  note("used", [(x % 7) | 0, (x % 4294967296) | 0, (x % 4294967296) >>> 0, x % 7 + 1, 1 / (x % 2), 1 / (x % 1024), Object.is(x % 3, -0), Math.abs(x % 5), String(x % 1000)]);
}

function generators(seed: number): number[] {
  let a = seed, b = seed, c = seed, d = seed;
  for (let i = 0; i < 50; i++) {
    a = (a * 9301 + 49297) % 233280;
    b = (b * 16807) % 2147483647;
    c = (c * 1103515245 + 12345) % 2147483648;
    d = (d * 1664525 + 1013904223) % 4294967296;
  }
  return [a, b, c, d];
}

function evens(list: number[]): number {
  return list.filter(n => n % 2 === 0).length * 1000 + list.filter(n => n % 3).length;
}

for (let round = 0; round < 2; round++) {
  for (const x of numbers) {
    tested(launder(x));
    asNumbers(launder(x));
  }
  for (const seed of [1, 42, 12345, 2147483646, 0.5, -7]) note("generators", generators(launder(seed)));
  note("lists", [evens(launder(numbers)), evens(launder([1, 2, 3, 4, 5, 6])), evens(launder([1.5, 2.5, -4, -0]))]);
}
console.log(lines, digest);
