// Elements of arrays that hold numbers alone, read for arithmetic under keys that are numbers of any kind: fractions, -0, NaN, infinities, keys past the end.
const ints: number[] = [];
const doubles: number[] = [];
for (let i = 0; i < 12; i++) {
  ints.push((i * 7) % 13);
  doubles.push(((i * 7) % 13) / 4);
}

class Grid {
  constructor(
    readonly cells: number[],
    readonly width: number,
  ) {}
  get(x: number, y: number): number {
    return this.cells[y * this.width + x];
  }
  around(x: number, y: number): number {
    let sum = 0;
    for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) sum += this.get(x + dx, y + dy);
    return sum;
  }
}

function direct(list: number[], from: number, step: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += list[from + i * step];
  return sum;
}

function wrapped(list: number[], x: number, n: number): number {
  let sum = 0;
  for (let i = -2; i <= 2; i++) sum = sum * 2 + list[(x + i + n) % n];
  return sum;
}

function known(list: number[], x: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const element = list[x * 0.5 + i];
    if (element > -1) sum += element * 2;
  }
  return sum;
}

const numbers = [0, 1, 2, 3, 5, -1, -2, -0, 0.5, 1.5, 11, 12, 20, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53, 1e300];
const said: string[] = [];
for (const a of numbers) {
  said.push(known(ints, a) + " " + known(doubles, a));
  for (const b of numbers) {
    said.push(direct(ints, a, b) + " " + direct(doubles, a, b) + " " + wrapped(ints, a, b) + " " + wrapped(doubles, a, b));
    said.push(new Grid(ints, a).around(b, 1) + " " + new Grid(doubles, a).around(b, 0));
  }
}
let hash = 0;
for (const line of said) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(said.length, hash);
for (let i = 0; i < said.length; i += 23) console.log(said[i]);
