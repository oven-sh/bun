// A relation on a square bounds its factor: small and large bounds, factors below zero, squares past 2 ** 53, the last factor and the one behind it.
const lines: string[] = [];
const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : String(value));
function sieve(flags: Uint8Array): number {
  flags.fill(1);
  for (let i = 2; i * i < flags.length; i++) if (flags[i]) for (let j = i * i; j < flags.length; j += i) flags[j] = 0;
  let count = 0;
  for (let i = 2; i < flags.length; i++) count += flags[i]!;
  return count;
}
function roots(view: Uint8Array, from: number): string {
  const found: number[] = [];
  let x = from | 0;
  while (x * x < view.length && found.length < 6) {
    found.push(x, (x * 100000000) | 0, x >>> 0, x % 7, view[x] ?? -1, (x + 2147483647) | 0);
    x -= 3;
  }
  return found.map(show).join() + " " + x;
}
function within(x: number, bound: number): string {
  const y = x | 0;
  if (y * y <= (bound | 0)) return "in " + (y * y * y) + " " + ((y << 16) >> 16) + " " + (y + 4294967295);
  return "out " + (y * y) + " " + (y + y);
}
function exact(x: number): string {
  const y = Math.floor(x);
  if (y * y < 4503599627370496) return "below " + (y + 1) * (y - 1) + " " + (y >>> 1);
  return "above " + y * y;
}
function flipped(list: number[], x: number): number {
  let y = x | 0,
    sum = 0;
  for (let turn = 0; turn < 40 && list.length > y * y; turn++, y++) sum = (sum + list[y * y]! + (list[y] ?? 1)) | 0;
  return sum;
}
for (const length of [0, 1, 4, 5, 100, 10007, 70000]) lines.push("sieve " + sieve(new Uint8Array(length)));
for (const from of [0, 1, -1, 2, 10, -10, 65535, 65536, -65536, 46340, 46341, -46341, 2147483647, -2147483648]) lines.push(roots(new Uint8Array(101).fill(7), from), roots(new Uint8Array(0), from));
for (const x of [0, -0, 1, -1, 46340, 46341, -46340, -46341, 65536, 2147483647, -2147483648]) for (const bound of [0, 1, -1, 100, 2147483647, -2147483648]) lines.push(within(x, bound));
for (const x of [0, 1, -1, 67108863, 67108864, 67108865, -67108864, 94906265, 94906266, 1e15, -1e15, 0.5, NaN, Infinity]) lines.push(exact(x));
for (const x of [0, -5, 3, 9]) lines.push(String(flipped(Array.from({ length: 50 }, (_, i) => i * 3), x)), String(flipped([], x)));
console.log(lines.join("\n"));
