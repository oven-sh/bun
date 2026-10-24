// Impostors narrowing and accessors: wg probes shrink  value read. It prints what plain Bun prints.
class Cell {
  value: number | string = 1;
}

const cell = new Cell();
Object.assign(cell, { value: "text" });
console.log(typeof cell.value, cell.value);
