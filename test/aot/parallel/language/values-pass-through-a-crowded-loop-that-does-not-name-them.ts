// Values that are computed in front of a loop and read behind it keep what they held, however many values the loop itself holds, however many turns it takes and however it is left.
const lines: string[] = [];

function integers(list: number[], turns: number): number {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  for (let i = 0; i < list.length; i++) {
    const x = list[i]! | 0;
    a = (a + x) | 0;
    b = (b ^ a) | 0;
    c = (c + b) | 0;
    d = (d ^ c) | 0;
    e = (e + d) | 0;
    f = (f ^ e) | 0;
    g = (g + f) | 0;
    h = (h ^ g) | 0;
  }
  let count = 0, other = 1;
  for (let i = 0; i < turns; i++) {
    count = (count + (i ^ other)) | 0;
    other = (other + count) | 0;
  }
  return (a + b * 3 + c * 5 + d * 7 + e * 11 + f * 13 + g * 17 + h * 19 + count + other) | 0;
}

function fractions(list: number[], turns: number): number {
  let a = 0.5, b = 1.5, c = 2.5, d = 3.5, e = 4.5, f = 5.5, g = 6.5, h = 7.5, k = 8.5, l = 9.5, m = 10.5, n = 11.5, o = 12.5, p = 13.5;
  for (let i = 0; i < list.length; i++) {
    const x = list[i]!;
    a += x; b += a * 0.5; c += b * 0.5; d += c * 0.5; e += d * 0.5; f += e * 0.5; g += f * 0.5;
    h += g * 0.5; k += h * 0.5; l += k * 0.5; m += l * 0.5; n += m * 0.5; o += n * 0.5; p += o * 0.5;
  }
  let sum = 0, scale = 1;
  for (let i = 0; i < turns; i++) {
    sum += i * scale;
    scale = scale * 0.999999 + 0.0000001;
  }
  return a + b + c + d + e + f + g + h + k + l + m + n + o + p + sum + scale;
}

const steps: unknown[][] = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
function pairs(turns: number, a: number, b: number, c: number, d: number, e: number): string {
  const first = a * 3 + b, second = b * 5 + c, third = c * 7 + d, fourth = d * 11 + e, fifth = e * 13 + a;
  let x = 0, y = 0;
  for (let i = 0; i < turns; i++) {
    const [dx, dy] = steps[i & 7]!;
    x += dx as number;
    y += dy as number;
  }
  return [x, y, first, second, third, fourth, fifth].join();
}

function leftByThrow(list: number[], turns: number, stopsAt: number): string {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  for (let i = 0; i < list.length; i++) {
    const x = list[i]! | 0;
    a = (a + x) | 0; b = (b ^ a) | 0; c = (c + b) | 0; d = (d ^ c) | 0;
    e = (e + d) | 0; f = (f ^ e) | 0; g = (g + f) | 0; h = (h ^ g) | 0;
  }
  let count = 0, other = 1;
  try {
    for (let i = 0; i < turns; i++) {
      if (i === stopsAt) throw new RangeError("at " + i);
      count = (count + (i ^ other)) | 0;
      other = (other + count) | 0;
    }
  } catch (error) {
    return [(error as Error).message, a, b, c, d, e, f, g, h, count, other].join();
  }
  return [a, b, c, d, e, f, g, h, count, other].join();
}

function nested(list: number[], rows: number, columns: number): number {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7;
  for (let i = 0; i < list.length; i++) {
    const x = list[i]! | 0;
    a = (a + x) | 0; b = (b ^ a) | 0; c = (c + b) | 0; d = (d ^ c) | 0; e = (e + d) | 0; f = (f ^ e) | 0; g = (g + f) | 0;
  }
  let total = 0;
  for (let row = 0; row < rows; row++) {
    let inRow = row;
    for (let column = 0; column < columns; column++) inRow = (inRow * 31 + (column ^ total)) | 0;
    total = (total + inRow + a) | 0;
  }
  return (total + b + c + d + e + f + g) | 0;
}

const list: number[] = [];
for (let i = 0; i < 100; i++) list.push(i * 7 + 1);
const halves = list.map(x => x / 2);
for (const turns of [-1, 0, 1, 10, 1000, (1 << 20) - 1, 1 << 20, (1 << 20) + 1, 3000000]) {
  lines.push(`${turns}: ${integers(list, turns)} ${integers([], turns)} ${fractions(halves, turns)} ${pairs(turns, 1, 2, 3, 4, 5)}`);
  lines.push(`${turns}: ${leftByThrow(list, turns, turns - 1)} | ${leftByThrow(list, turns, turns)} | ${leftByThrow(list, turns, turns >> 1)}`);
}
lines.push(`${nested(list, 3, 1500000)} ${nested(list, 1500, 300)} ${nested(list, 0, 5)} ${nested(list, 5, 0)}`);
steps[5] = ["2", 0.5];
lines.push(pairs(20, 1, 2, 3, 4, 5), pairs(2500000, 5, 4, 3, 2, 1).length.toString());
console.log(lines.join("\n"));
