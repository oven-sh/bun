// Loops whose bound is a captured variable: undefined until it is assigned, then an integer. Before the loop it is checked for an integer; undefined ends the loop at once.
function makeGrid(list: any) {
  var width: any;
  var height: any;
  var size: any;
  var rowSize: any;
  function resize(w: number, h: number): boolean {
    var cells = w * h;
    if (cells > 0 && cells < 1000000) {
      width = w;
      height = h;
      rowSize = width + 2;
      size = (width + 2) * (height + 2);
      return true;
    }
    return false;
  }
  function sumRow(x: any, row: number): number {
    var sum = 0;
    var at = row * rowSize;
    for (var i = 1; i <= width; i++) sum += x[++at];
    return sum;
  }
  function sumBelow(x: any): number {
    var sum = 0;
    for (var i = 0; i < size; i++) sum += x[i];
    return sum;
  }
  function sumAbove(x: any): number {
    var sum = 0;
    for (var i = 0; size > i; i += 2) sum = sum * 0.5 + x[i];
    return sum;
  }
  function sumDown(x: any): number {
    var sum = 0;
    for (var i = 20; i >= height; i--) sum += x[i];
    return sum;
  }
  function relax(x: any, y: any): void {
    for (var j = 1; j <= height; j++) {
      var last = (j - 1) * rowSize;
      var current = j * rowSize;
      var next = (j + 1) * rowSize;
      var carried = x[current];
      ++current;
      for (var i = 1; i <= width; i++) carried = x[current] = (y[current] + 0.25 * (carried + x[++current] + x[++last] + x[++next])) * 0.5;
    }
  }
  // The loop changes its own bound.
  function shrink(x: any): number {
    var sum = 0;
    for (var i = 0; i < width; i++) {
      sum += x[i];
      if (i & 1) width--;
    }
    return sum;
  }
  function clear(): void {
    width = undefined;
  }
  return { resize, sumRow, sumBelow, sumAbove, sumDown, relax, shrink, clear, list };
}
// Only integers are assigned.
function makeField() {
  var width: any;
  var height: any;
  var rowSize: any;
  function resize(w: number, h: number): void {
    if (w > 0 && h > 0 && w < 1000) {
      width = w;
      height = h;
      rowSize = width + 2;
    }
  }
  function sum(x: any): number {
    var sum = 0.5;
    for (var i = 1; i <= width; i++) sum += x[i];
    return sum;
  }
  function alternate(x: any): number {
    var sum = 0.5;
    for (var i = 0; width > i; i++) sum = x[i] - sum;
    return sum;
  }
  function fill(x: any, y: any): void {
    var at = 3;
    for (var i = 0; i < height; i++) x[i] = y[++at] * 0.5;
  }
  function smooth(x: any, y: any): void {
    for (var j = 1; j <= height; j++) {
      var last = (j - 1) * rowSize;
      var current = j * rowSize;
      var next = (j + 1) * rowSize;
      var carried = x[current];
      ++current;
      for (var i = 1; i <= width; i++) carried = x[current] = (y[current] + 0.25 * (carried + x[++current] + x[++last] + x[++next])) * 0.5;
    }
  }
  return { resize, sum, alternate, fill, smooth };
}
const doubles: number[] = [];
const ints: number[] = [];
for (let i = 0; i < 64; i++) {
  doubles.push(((i * 7) % 13) / 4);
  ints.push((i * 5) % 17);
}
const holes: any[] = doubles.slice();
delete holes[9];
const mixed: any[] = [1, "2", null, undefined, 4.5, true, { valueOf: () => 3 }, 8, 9, 10, 11, 12];
const lines: string[] = [];
const grid = makeGrid(doubles);
for (const list of [doubles, ints, holes, mixed]) lines.push([grid.sumRow(list, 0), grid.sumBelow(list), grid.sumAbove(list), grid.sumDown(list), grid.shrink(list)].join(" "));
for (const [w, h] of [[4, 4], [6, 6], [1, 1], [0, 3], [5, 2], [30, 1]]) {
  lines.push(String(grid.resize(w, h)));
  for (const list of [doubles, ints, holes, mixed]) {
    lines.push([grid.sumRow(list, 0), grid.sumRow(list, 1), grid.sumRow(list, 9), grid.sumBelow(list), grid.sumAbove(list), grid.sumDown(list)].join(" "));
    const x = list.slice();
    grid.relax(x, list);
    grid.relax(x, ints);
    lines.push(x.map(String).join());
    grid.relax(ints.slice(), x);
    lines.push(String(grid.shrink(list)));
    grid.resize(w, h);
  }
}
grid.clear();
lines.push(String(grid.sumRow(doubles, 1)), String(grid.sumBelow(doubles)));
const field = makeField();
const sayField = () => {
  for (const list of [doubles, ints, holes]) {
    const x = list.slice();
    field.fill(x, doubles);
    field.smooth(x, list);
    field.smooth(x, ints);
    lines.push([field.sum(list), field.alternate(list), x.map(String).join()].join(" "));
  }
};
sayField();
field.resize(4, 6);
sayField();
field.resize(9, 3);
sayField();
field.resize(0, 3);
field.resize(20, 60);
sayField();
console.log(lines.join("\n"));
