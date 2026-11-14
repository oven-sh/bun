// A whole sum, difference or product of doubles that is stored where whole numbers lie.
const say = (name: string, value: unknown) => console.log(name, JSON.stringify(value));

function gridTyped(n: number) {
  const grid: number[][] = [[0, 1, 2], [3, 4, 5]];
  for (let i = 0; i < n; i++) grid[i & 1][i % 3] += i;
  return grid;
}
function gridTypedSummed(n: number) {
  const grid: number[][] = [[0, 1, 2], [3, 4, 5]];
  let total = 0;
  for (let i = 0; i < n; i++) {
    grid[i & 1][i % 3] += i;
    total += grid[i & 1][i % 3];
  }
  return [grid, total];
}
function gridUnknown(grid: any, n: number) {
  for (let i = 0; i < n; i++) {
    const y = i % grid.length;
    grid[y][0] += i;
    grid[y][1] -= i;
    grid[y][2] *= 2;
  }
  return grid;
}
function rowTyped(row: number[], n: number) {
  for (let i = 0; i < n; i++) row[i % row.length] += i;
  return row;
}
function rowDifferences(row: number[], n: number) {
  for (let i = 0; i < n; i++) row[i % row.length] -= i * 2;
  return row;
}
function rowProducts(row: number[], n: number) {
  for (let i = 0; i < n; i++) row[i % row.length] *= -1;
  return row;
}
function rowSteps(row: number[], n: number) {
  for (let i = 0; i < n; i++) row[i % row.length]++;
  return row;
}
function rowOfSums(left: number[], right: number[], out: number[]) {
  for (let i = 0; i < left.length; i++) out[i] = left[i] + right[i];
  return out;
}
function rowOfProducts(left: any, right: any, out: any) {
  for (let i = 0; i < left.length; i++) out[i] = left[i] * right[i] - left[i];
  return out;
}
function pushed(left: number[], right: number[]) {
  const out: number[] = [];
  for (let i = 0; i < left.length; i++) out.push(left[i] + right[i]);
  return out;
}
function fields(list: any, n: number) {
  for (let i = 0; i < n; i++) {
    const o = list[i % list.length];
    o.x += o.y;
    o.y = o.x * 2 - i;
    o.n += i;
  }
  return list;
}
class Cell {
  count = 0;
  sum = 0;
  list: number[] = [0, 0, 0];
  add(value: number, at: number) {
    this.count++;
    this.sum += value;
    this.list[at] += value;
  }
}
function cells(values: number[], n: number) {
  const cell = new Cell();
  for (let i = 0; i < n; i++) cell.add(values[i % values.length], i % 3);
  return cell;
}
function views(values: number[], n: number) {
  const ints = new Int32Array(4), bytes = new Uint8ClampedArray(4), floats = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    const v = values[i % values.length] + values[(i + 1) % values.length];
    ints[i & 3] += v;
    bytes[i & 3] += v;
    floats[i & 3] += v;
  }
  return [Array.from(ints), Array.from(bytes), Array.from(floats)];
}
function uses(values: any, n: number) {
  const map = new Map<number, number>(), set = new Set<number>(), seen: any = {}, out: any[] = [];
  const names = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
  for (let i = 0; i < n; i++) {
    const v = values[i % values.length] + values[(i + 2) % values.length];
    map.set(v, (map.get(v) ?? 0) + 1);
    set.add(v);
    seen[v] = (seen[v] ?? 0) + v;
    out.push(names[v], names.at(v), v | 0, v >>> 1, v & 3, ~v, v === 3, v == 4, Object.is(v, 2), [1, 2, 3].includes(v), [1, 2, 3].indexOf(v), String(v), `${v}`, v.toString(2), Number.isInteger(v));
    switch (v) {
      case 1: out.push("one"); break;
      case 2: out.push("two"); break;
      case 3: out.push("three"); break;
      default: out.push("more");
    }
  }
  return [[...map], [...set], seen, out];
}
function limits(values: number[]) {
  const row: number[] = [0, 0, 0, 0];
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    row[i & 3] += values[i];
    out.push(1 / row[i & 3]);
  }
  return [row, out.map(String)];
}

for (const n of [1, 2, 3, 8, 40]) {
  say("typed", gridTyped(n));
  say("summed", gridTypedSummed(n));
  say("parsed", gridUnknown(JSON.parse("[[0,0,1],[0,0,1],[0,0,1]]"), n));
  say("halves", gridUnknown(JSON.parse("[[0.5,0,1],[0,0.5,1],[0,0,1.5]]"), n));
  say("literal", gridUnknown([[0, 0, 1], [0, 0, 1]], n));
  say("empty", gridUnknown([[0, , 1], [, 0, 1]], n));
  for (const row of [[0, 0, 0], [1, 2, 3], [0.5, 0.5, 1], [2147483646, 2147483647, -2147483648], [0, -0, 0]]) {
    say("row +=", rowTyped(row.slice(), n));
    say("row -=", rowDifferences(row.slice(), n));
    say("row *=", rowProducts(row.slice(), n));
    say("row ++", rowSteps(row.slice(), n));
  }
  say("fields", fields(JSON.parse('[{"x":1,"y":2,"n":0},{"x":0.5,"y":0.5,"n":0}]'), n));
  say("cells", cells([1, 2, 3], n));
  say("cells", cells([0.5, 1.5, 2], n));
  say("views", views([0.5, 1.5, 2.5, 3], n));
  say("uses", uses([0.5, 1, 1.5, 2], n));
  say("uses", uses(JSON.parse("[0.5,1.5,2.5,0.5]"), n));
}
say("sums", rowOfSums([0.5, 1.5, 2], [0.5, 0.5, 1], [0, 0, 0]));
say("sums", rowOfSums([1, 2, 3], [0.5, 1, 0.5], [1, 2, 3]));
say("products", rowOfProducts([0.5, 2, 3], [2, 4, 1], [1, 2, 3]));
say("products", rowOfProducts(JSON.parse("[0.5,2,3]"), JSON.parse("[4,0.5,1]"), JSON.parse("[1,2,3]")));
say("pushed", pushed([0.5, 1.5], [0.5, 0.5]));
say("pushed", pushed([1, 2], [0.5, 0.5]));
say("limits", limits([2147483647, 1, -2147483648, -1, 0.5, 0.5, -0.5, 0, 2147483647, -1, 2147483648, 4294967295]));
say("limits", limits([0, -0, 0, -0, -0, -0, 1e308, 1e308, 0.5, 0.5]));
