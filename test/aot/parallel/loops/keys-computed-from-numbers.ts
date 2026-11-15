// Keys computed from numbers that a loop does not change: parameters, fields, through small methods and functions. In front of the loop they are checked for int32s; what is none runs the generic version.
const flat: number[] = [];
const rows: number[][] = [];
for (let y = 0; y < 6; y++) {
  const row: number[] = [];
  for (let x = 0; x < 6; x++) {
    row.push(y * 7 + x * 3);
    flat.push(y * 7 + x * 3 + 0.5);
  }
  rows.push(row);
}

class Grid {
  constructor(
    public width: number,
    public height: number,
    readonly cells: number[],
    readonly lines: number[][],
  ) {}
  get(x: number, y: number): number {
    return this.cells[y * this.width + x];
  }
  wrapped(x: number, y: number): number {
    const line = this.lines[(y + this.height) % this.height];
    return line === undefined ? -1 : line[(x + this.width) % this.width];
  }
  near(x: number, y: number): number {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum = sum * 3 + this.get(x + dx, y + dy);
    return sum;
  }
  around(x: number, y: number): number {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum = sum * 3 + this.wrapped(x + dx, y + dy);
    return sum;
  }
  // The width changes inside the loop.
  growing(x: number): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      sum = sum * 3 + this.get(x, i);
      if (i === 2) this.width += x % 2 ? 1 : 0.5;
    }
    return sum;
  }
}

function window3(list: number[], x: number, y: number, width: number): number {
  let sum = 0;
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) sum = sum * 3 + list[(y + dy) * width + x + dx];
  return sum;
}

function store(x: number, width: number): string {
  const list: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) list[(i * width + x) % 8] = i + 0.25;
  return list.join();
}

let shared = 3;
function bySharedVariable(list: number[], x: number): number {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    sum = sum * 3 + list[i * shared + x];
    if (sum > 100) shared = x;
  }
  return sum;
}

function* steps(list: number[], x: number, width: number) {
  for (let i = 0; i < 3; i++) yield list[i * width + x];
}

const numbers = [0, 1, 2, 3, 6, -1, -0, 0.5, 2.5, 1 << 20, (1 << 20) + 1, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 2 ** 53, 1e300, NaN, Infinity];
const said: string[] = [];
for (const a of numbers) {
  for (const b of numbers) {
    const grid = new Grid(a, b, flat, rows);
    said.push([grid.near(2, 1), grid.around(2, 1), new Grid(6, 6, flat, rows).near(a, b), new Grid(6, 6, flat, rows).around(a, b), grid.growing(1), grid.growing(2)].join());
    said.push([window3(flat, a, 1, b), window3(flat, 1, a, b), store(a, b), [...steps(flat, a, b)]].join());
  }
  shared = a;
  said.push(String(bySharedVariable(flat, 1)) + shared);
}
let hash = 0;
for (const line of said) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(said.length, hash);
for (let i = 0; i < said.length; i += 41) console.log(said[i]);

// The constructor fills the field inside its loop.
class Late {
  width!: number;
  sum = 0;
  constructor(list: number[], width: number) {
    for (let i = 0; i < 4; i++) {
      if (i === 0) this.width = width;
      this.sum = this.sum * 3 + list[i * this.width + 1];
    }
  }
}
console.log(new Late(flat, 2).sum, new Late(flat, 3.5).sum, new Late(flat, 0).sum, new Late(flat, -1).sum);
