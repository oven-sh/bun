// An ordinary object is spread into a literal whose fields are typed as numbers. The copy is repeated, so the run time copies it the way it did before.
// The values lie at the edges of what a 32-bit slot holds, on both sides, and some are no integers at all.
interface Defaults { a: number; b: number; c: number }
const defaults: Defaults = Object.create(Object.prototype);
defaults.a = 1;
defaults.b = 2;
defaults.c = 3;
function withExtra(extra: number) {
  return { ...defaults, extra };
}
const makers = [withExtra];
const values = [
  0, 1, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536,
  2147483647, 2147483646, -2147483642, -2147483643, -2147483644, -2147483645, -2147483646, -2147483647, -2147483648,
  2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, -9007199254740991, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21,
];
const lines: string[] = [];
for (const value of values) {
  for (let again = 0; again < 3; again++) {
    defaults.a = value;
    defaults.c = again === 1 ? value : again;
    const made = makers[0]!(again);
    lines.push(`${Object.is(made.a, value)} ${made.a} ${made.b} ${Object.is(made.c, defaults.c)} ${made.extra} ${Object.keys(made).join()}`);
  }
}
console.log(lines.join("\n"));
// After numbers that fit no integer slot, small ones again.
defaults.a = 7;
defaults.c = 9;
const last = makers[0]!(4);
console.log(last.a + last.b + last.c + last.extra, JSON.stringify(last));
