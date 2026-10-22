// Impostors narrowing and accessors: wg probes shrink  a null is also stored plainly. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const other = new Cell();
other.leaf = null;
const cell = new Cell();
Object.assign(cell, { leaf: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
