// while (--n >= 0) over arrays: n enters as any number. The preheader asks for an int32; fractions, NaN and counts past int32 go by the version as written.
function carry(a: number[], i: number, x: number, b: number[], j: number, c: number, n: number): string {
  const xl = x & 0x3fff, xh = x >> 14;
  while (--n >= 0) {
    let l = a[i]! & 0x3fff;
    const h = a[i++]! >> 14;
    const m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + b[j]! + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    b[j++] = l & 0xfffffff;
  }
  return [c, i, j, n].join();
}
function sum(a: number[], n: number): string {
  let s = 0;
  while (n-- > 0) s += a[n & 15]! * 2;
  return [s, n].join();
}
function untilLimit(a: number[], n: number): string {
  let s = 0, i = 0;
  for (; n < 20; n++) s += a[i++ & 15]! + n;
  return [s, i, n].join();
}
const any = (x: any): any => x;
const said: string[] = [];
const counts = [10, 12.5, NaN, -1, 0, -0, 3.0, any("5") * 1, 16.000001, -Infinity, 2 ** 31 - 2 ** 31 + 9];
for (let round = 0; round < 33; round++) {
  const a: number[] = [], b: number[] = [];
  for (let k = 0; k < 40; k++) a.push((k * 7654321 + round * 12345) & 0xfffffff), b.push(round % 4 === 3 ? 0.5 : 0);
  if (round % 6 === 5) a[9] = 1.75;
  const n = any(counts[round % counts.length]!) as number;
  said.push(carry(a, round % 3, a[round % 40]!, b, round & 7, 0, n), b.slice(0, 10).join(), sum(a, n), untilLimit(a, n === -Infinity ? 1 : n));
}
console.log(said.join("\n"));
