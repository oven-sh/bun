// `x & mask` makes an int32 of x first, whatever number x is: beyond 2^63, a fraction, an infinity, NaN. Masks that keep few of the lowest bits stand beside masks that keep one bit more,
// known when the program is built and not, on either side of the operator, with numbers out of a list, out of a Float64Array, out of arithmetic and out of a value of any type.
const powers = [31, 32, 33, 52, 53, 62, 63, 64, 65, 74, 75, 100, 1023];
const numbers: number[] = [0, -0, 0.5, -0.5, 1.9, -1.9, 1023, 1024, 2047, 2048, 2049, -2047, -2048, -2049, 4294967295.9, -4294967297.2, NaN, Infinity, -Infinity, 1e300, -1e300, 5e-324];
for (const power of powers) {
  const size = 2 ** power;
  const step = Math.max(1, size / 2 ** 52);
  for (const sign of [1, -1]) for (const steps of [-3, -1, 0, 1, 3, 1023, 2047]) numbers.push(sign * (size + steps * step));
}
const floats = Float64Array.from(numbers);
const anything: unknown[] = numbers.map((value, k) => (k % 3 ? value : Math.trunc(value) | 0));
const masks = [0, 1, 255, 511, 1023, 2047, 2048, 4095, 65535, -1, -2048];

let check = 0;
function note(value: number): void {
  check = (Math.imul(check, 31) + value) | 0;
}

function withKnownMasks(x: number): void {
  note(x & 1);
  note(x & 255);
  note(1023 & x);
  note(x & 2047);
  note(x & 2048);
  note(4095 & x);
  note((x + 0.25) & 511);
  note((x * 2) & 2047);
  note((x & 2047) + (x | 0));
}

function withMasksInARange(x: number, mask: number): void {
  note(x & (mask & 2047));
  note((mask & 1023) & x);
  note(x & (mask & 4095));
  note(x & mask);
}

function ofAnyType(x: unknown): void {
  if (typeof x === "number") {
    note(x & 1023);
    note(2047 & x);
    note(x & 4095);
  }
}

for (let k = 0; k < numbers.length; k++) {
  withKnownMasks(numbers[k]!);
  withKnownMasks(floats[k]!);
  ofAnyType(anything[k]);
  for (const mask of masks) withMasksInARange(floats[k]!, mask);
  if (k % 16 === 0) console.log(k, numbers[k], check);
}
console.log(numbers.length, check);

const marks = Array.from({ length: 64 }, (_, k) => k);
for (const by of [1, 2 ** 31, 2 ** 53, 2 ** 63, 2 ** 64 + 2 ** 13, -(2 ** 63) - 2 ** 12, 1e22, NaN, Infinity]) {
  for (let k = 0; k < marks.length; k++) marks[k] = (marks[k]! + by) & 1023;
  console.log(by, marks[0], marks[1], marks[63]);
}
