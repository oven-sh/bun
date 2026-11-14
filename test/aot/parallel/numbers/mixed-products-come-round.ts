// A product of mixed bits leaves the int32s at once: no version of the loop holds it as one.
function grows(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = (h ^ bytes[i]!) * 16777619;
  return h;
}
function small(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = (h ^ bytes[i]!) * 31;
  return h;
}
function negative(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = ~(h & 0xff) * -70000 - bytes[i]!;
  return h;
}
function collatz(n: number): number {
  let steps = 0;
  for (; n !== 1 && steps < 500; steps++) n = n & 1 ? 3 * n + 1 : n >> 1;
  return steps;
}
const bytes = new Uint8Array([1, 2, 3, 4, 250, 0, 7]);
for (const seed of [2166136261, 0, -1, 0.5, -0, NaN, 4294967296, -2147483649, 1e300, 27, 2147483647])
  console.log(grows(seed, bytes), small(seed, bytes), negative(seed, bytes), collatz(seed));
