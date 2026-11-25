// Arithmetic that leaves the small integers, BigInt of fixed width, Math.
// Sizes: 1000 4000 16000
// Passes: 63
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
function mix(i: number): number {
  const wide = i * 2147483647,
    part = wide / 3;
  return (
    (Math.floor(part) % 1000) +
    (Math.imul(i, 31) % 7) +
    Math.hypot(i & 3, 4) +
    Number((BigInt(i) * 3n) % 11n) +
    (wide > 2 ** 53 ? 1 : 0)
  );
}
function once(): string {
  let sum = 0;
  for (let i = 0; i < size * 4; i++) sum += mix(i);
  return [Math.round(sum)].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
