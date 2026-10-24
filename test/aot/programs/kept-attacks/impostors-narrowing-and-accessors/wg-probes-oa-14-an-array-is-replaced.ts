// Impostors narrowing and accessors: wg probes oa  an array is replaced. It prints what plain Bun prints.
class Cell {
  list: number[] = [1, 2, 3];
}

const cell = new Cell();
Object.assign(cell, { list: [] });
console.log(cell.list.length, cell.list[0], cell.list.join());
Object.assign(cell, { list: [1.5, 2.5] });
console.log(cell.list.length, cell.list[0], cell.list.join());
