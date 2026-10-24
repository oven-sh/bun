// Impostors narrowing and accessors: wg probes shrink  undefined. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | undefined = new Leaf();
}

function weigh(c: Cell): number {
  return c.leaf === undefined ? -1 : c.leaf.weight;
}

const cell = new Cell();
Object.assign(cell, { leaf: undefined });
console.log(weigh(cell));
