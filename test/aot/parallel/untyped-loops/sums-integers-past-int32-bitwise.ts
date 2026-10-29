// Sums, differences and products of integers that leave the int32 range, handed to every bitwise operator.
const words = new Uint32Array([0, 1, 2, 255, 65535, 65536, 2147483647, 2147483648, 2147483649, 4294967294, 4294967295]);
const signed = new Int32Array([0, 1, -1, 2, -2, 46341, -46341, 65536, -65536, 2147483647, -2147483648, -2147483647]);
const bytes = new Uint8Array([0, 1, 127, 128, 255]);
const floats = new Float64Array([0, -0, 0.5, 4294967296, 9007199254740991, -9007199254740991, 1e300, NaN, Infinity]);
const plain = [0, 1, -1, 2147483647, -2147483648, 4294967295, 9007199254740991];
const given: number[] = JSON.parse("[0,1,-1,2147483647,-2147483648,4294967295,4294967296,9007199254740991,0.5,-0.5,1e21]");
const lines: string[] = [];

function overWords(list: ArrayLike<number>): string {
  let or = 0, and = 0, xor = 0, left = 0, right = 0, unsigned = 0, not = 0;
  for (let i = 0; i < list.length; i++) {
    for (let k = 0; k < list.length; k++) {
      const a = list[i]!, b = list[k]!;
      or = (or + ((a + b) | 0)) | 0;
      and = (and + ((a + b) & 0xff00ff)) | 0;
      xor = (xor + ((a - b) ^ 0x55555555)) | 0;
      left = (left + ((a + b) << 3)) | 0;
      right = (right + ((a - b) >> 2)) | 0;
      unsigned = (unsigned + ((a - b) >>> 1)) | 0;
      not = (not + ~(a + b)) | 0;
    }
  }
  return [or, and, xor, left, right, unsigned, not].join(" ");
}

function products(list: ArrayLike<number>): string {
  let s = 0, t = 0, u = 0;
  for (let i = 0; i < list.length; i++) {
    for (let k = 0; k < list.length; k++) {
      s = (s + ((list[i]! * list[k]!) | 0)) | 0;
      t = (t + ((list[i]! * list[k]! + list[i]!) >>> 0)) | 0;
      u = (u + ((-list[i]!) | 0) + (~(-list[k]!))) | 0;
    }
  }
  return s + " " + t + " " + u;
}

function steps(list: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    let up = list[i]!, down = list[i]!;
    up++; up++; down--; down--;
    s = (s + (up | 0) + (down | 0) + (up >>> 0) % 1000 + (down >> 1)) | 0;
  }
  return s;
}

function runningSum(list: ArrayLike<number>, turns: number): string {
  let s = 0, wide = 0;
  for (let t = 0; t < turns; t++) {
    for (let i = 0; i < list.length; i++) {
      s = s + list[i]! | 0;
      wide = wide + list[i]!;
    }
  }
  return s + " " + (wide | 0) + " " + (wide >>> 0) + " " + wide;
}

function lengths(text: string, list: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < 40; i++)
    s = (s + ((text.length * 1073741824 + list.length * 2147483647 + i) | 0)) ^ (list.length - text.length - 2147483648 >> 1);
  return s;
}

function counters(limit: number): number {
  let s = 0;
  for (let i = 2147483640; i < limit; i++)
    s = (s + ((i + i) | 0) + ((i + 1) >>> 0) % 7 + ((i * 2) >> 1)) | 0;
  for (let i = -2147483640; i > -limit; i--)
    s = (s + ((i + i) | 0) + ((i - 1) >>> 0) % 7 + ((i * 3) >> 1)) | 0;
  return s;
}

for (let round = 0; round < 3; round++) {
  for (const list of [words, signed, bytes, floats, plain, given]) {
    lines.push(overWords(list));
    lines.push(products(list));
    lines.push(String(steps(list)));
    lines.push(runningSum(list, 5));
    lines.push(String(lengths("abc" + round, list)));
  }
  lines.push(String(counters(2147483660)));
  lines.push(String(counters(2147483660.5)));
}
console.log(lines.join("\n"));
