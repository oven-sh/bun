// A counted loop of over 2 ** 20 turns runs in stretches however much a turn does: with many values alive, with its bound read in the turn or behind the loop, and left now and then for a slower path.
const lines: string[] = [];

function mixUp(from: number, to: number): number {
  let a = 1, b = 2, c = 3, d = 5, e = 7, f = 11;
  for (let i = from; i < to; i++) {
    a = (Math.imul(a, 31) + i) | 0;
    b = (b ^ (a >>> 3)) | 0;
    c = (c + (b & 255) - (i >> 2)) | 0;
    d = (Math.imul(d ^ c, 17) + (a << 1)) | 0;
    e = (e + (d >>> 7) + (c & i)) | 0;
    f = (f ^ (e + a + b)) | 0;
  }
  return a ^ b ^ c ^ d ^ e ^ f;
}
function mixDownByThree(from: number, to: number): number {
  let a = 1, b = 2, c = 3, d = 5, e = 7, last = 0;
  for (let i = from; i > to; i -= 3) {
    a = (Math.imul(a, 33) ^ i) | 0;
    b = (b + (a >>> 5)) | 0;
    c = (c ^ (b << 2) ^ (i & 1023)) | 0;
    d = (Math.imul(d + c, 13) - a) | 0;
    e = (e ^ (d >>> 9) ^ (b & c)) | 0;
    last = i;
  }
  return a ^ b ^ c ^ d ^ e ^ last;
}
function boundReadInTheTurn(from: number, to: number): number {
  let a = 1, b = 2, c = 3, d = 5;
  for (let i = from; i <= to; i++) {
    a = (Math.imul(a, 29) + (to - i)) | 0;
    b = (b ^ (a >>> 4) ^ to) | 0;
    c = (c + (b & 4095) + (i ^ to)) | 0;
    d = (Math.imul(d ^ c, 19) + (a >> 3) + (b << 1)) | 0;
  }
  return a ^ b ^ c ^ d;
}
function boundReadBehindTheLoop(from: number, to: number): number {
  let a = 1, b = 2, c = 3, d = 5, i = from;
  for (; i < to; i += 2) {
    a = (Math.imul(a, 37) + i) | 0;
    b = (b ^ (a >>> 6)) | 0;
    c = (c + (b & 511) - (i >> 1)) | 0;
    d = (Math.imul(d ^ c, 23) + (a << 2) + (b >>> 1)) | 0;
  }
  return (a ^ b ^ c ^ d) + (to - i);
}
function testedAtTheEnd(from: number, to: number): number {
  let a = 1, b = 2, c = 3, d = 5, i = from;
  do {
    a = (Math.imul(a, 41) + i) | 0;
    b = (b ^ (a >>> 2)) | 0;
    c = (c + (b & 127) + (i << 1)) | 0;
    d = (Math.imul(d ^ c, 11) + (a >> 5) + (b ^ i)) | 0;
  } while (++i < to);
  return a ^ b ^ c ^ d ^ i;
}

const texts = ["", "a", "four", "seventeen letters"];
function manyValuesStayAliveAroundTheLoop(n: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + texts[i & 3].length) | 0;
  return sum + p * 2 + q * 3 + r * 5 + s * 7 + t * 11 + u * 13 + v * 17 + w * 19;
}

interface Counted {
  length: number;
}
const mostlyTexts: Counted[] = ["four", "ab", "c", "", "seven..", "x", "yz", [1, 2, 3]];
const everyKind: Counted[] = ["four", [1, 2, 3], new Float64Array(2), new Int8Array(5), new Uint16Array(7), new Int32Array(1), "ab", [4]];
function leftNowAndThen(list: Counted[], every: number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + list[i % every === 0 ? 7 : i & 3].length) & 0xffffff;
  return sum;
}
function leftOnMostTurns(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + everyKind[i & 7].length) & 0xffffff;
  return sum;
}

const stretch = 2 ** 20;
for (const turns of [1, stretch, stretch + 1, 2 * stretch + 3]) {
  for (const from of [0, -7, 2147483646 - 3 * turns, -2147483648]) {
    lines.push(
      [
        turns,
        from,
        mixUp(from, from + turns),
        mixDownByThree(from + 3 * turns, from),
        boundReadInTheTurn(from, from + turns - 1),
        boundReadBehindTheLoop(from, from + 2 * turns - 1),
        testedAtTheEnd(from, from + turns),
      ].join(" "),
    );
  }
  lines.push(
    [
      manyValuesStayAliveAroundTheLoop(turns, 1, 2, 3, 4, 5, 6, 7, turns & 15),
      leftNowAndThen(mostlyTexts, 300007, turns),
      leftNowAndThen(mostlyTexts, 5, turns),
      leftOnMostTurns(turns),
    ].join(" "),
  );
}
lines.push(String(testedAtTheEnd(5, -5)), String(mixUp(5, -5)), String(mixDownByThree(-5, 5)));
console.log(lines.join("\n"));
