// Functions and methods with short counted nests, each called at one place inside loops: windows of grids that end inside, outside and past their rows.
const n = 9;
const rows: number[][] = [];
const flat: number[] = [];
for (let y = 0; y < n; y++) {
  const row: number[] = [];
  for (let x = 0; x < n; x++) {
    row.push(((x * 7 + y * 3) % 11) / 4);
    flat.push((x * 5 + y * 3) % 7);
  }
  rows.push(row);
}
let calls = 0;

class Grid {
  constructor(
    readonly cells: number[],
    readonly lines: number[][],
    readonly width: number,
    readonly height: number,
  ) {}
  get(x: number, y: number): number {
    return this.cells[y * this.width + x];
  }
  near(x: number, y: number): number {
    let sum = 0;
    for (let dy = 0; dy <= 2; dy++) for (let dx = 0; dx <= 2; dx++) sum = sum * 2 + this.get(x + dx, y + dy);
    return sum;
  }
  blurred(): string {
    const said: number[] = [];
    for (let y = 0; y < this.height - 2; y++) for (let x = 0; x < this.width - 2; x++) said.push(this.near(x, y));
    return said.join();
  }
}

function wrapped(lines: number[][], x: number, y: number, w: number, h: number): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += lines[(y + dy + h) % h][(x + dx + w) % w];
  return sum;
}
function allWrapped(lines: number[][], w: number, h: number): number {
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) total = (total * 3 + wrapped(lines, x, y, w, h)) % 100003;
  return total;
}

// Leaves the nest from its middle, skips, counts and throws.
function found(list: number[], x: number, y: number, w: number): number {
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const value = list[(y + dy) * w + x + dx];
      calls++;
      if (value === undefined) continue;
      if (value === 6) return dy * 10 + dx;
      if (value > 6) throw new RangeError("value " + value);
    }
  }
  return -1;
}
function allFound(list: number[], w: number): string {
  const said: (number | string)[] = [];
  for (let y = 0; y < n + 1; y++) {
    for (let x = 0; x < w; x++) {
      try {
        said.push(found(list, x, y, w));
      } catch (error) {
        said.push((error as Error).message);
      }
    }
  }
  return said.join();
}

// The nest stores into the array that it reads.
function smear(list: number[], x: number): number {
  let carried = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) carried += list[x + i * 2 + j] = (list[x + i + j] + carried) % 13;
  return carried;
}
function allSmeared(list: number[]): string {
  let total = 0;
  for (let x = 0; x < list.length - 3; x++) total += smear(list, x);
  return total + " " + list.join();
}

console.log(new Grid(flat, rows, n, n).blurred());
console.log(new Grid(flat, rows, 4.5, n).blurred());
console.log(new Grid(flat, rows, 3, 2 ** 20 + 5 - 2 ** 20).blurred());
console.log(allWrapped(rows, n, n), allWrapped(rows, 3, 5), allWrapped(rows, 2.5, 4));
try {
  console.log(allWrapped(rows, n, n + 2));
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(allFound(flat, n), calls);
console.log(allFound([...flat.slice(0, 20), 9], 4), calls);
console.log(allSmeared(flat.slice()));
