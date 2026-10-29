// `(u << 1) >>> 0` wraps at 32 bits and is then added as a wider integer. Code that is made without optimizing once took the shift for the scaled part of a 64-bit sum, [a + b * 2], where it
// does not wrap. Found by ../../fuzz/many-live-values.ts. The output is that of plain Bun.
function twice(flag: number, u: number): number {
  let sum = 0;
  if (flag & 1) {
    u = (u << 1) >>> 0;
    sum = u + u;
  }
  return sum + u;
}
let all = 0;
for (let i = 0; i < 40; i++) all += twice(i, (i * 1234567891) >>> 0);
console.log(all);
console.log(twice(1, 3000000000), twice(1, 4294967295), twice(1, 2147483648), twice(1, 1073741824), twice(0, 4294967295));
