// Impostors narrowing and accessors: wg probes oa  a callback is replaced. It prints what plain Bun prints.
class Cell {
  run: () => number = () => 1;
}

const cell = new Cell();
Object.assign(cell, { run: () => 2 });
console.log(cell.run());
