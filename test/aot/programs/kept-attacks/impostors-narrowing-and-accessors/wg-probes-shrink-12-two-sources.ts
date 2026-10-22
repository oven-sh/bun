// Impostors narrowing and accessors: wg probes shrink  two sources. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
  other = 1;
}

function weigh(c: Cell): number {
  return c.leaf === null ? -1 : c.leaf.weight;
}

const cell = new Cell();
Object.assign(cell, { other: 2 }, { leaf: null });
console.log(weigh(cell), cell.other);
