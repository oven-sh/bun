// Impostors narrowing and accessors: wg probes shrink  source is a class with initial values. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

class Empty {
  leaf = null;
}

function weigh(c: Cell): number {
  return c.leaf === null ? -1 : c.leaf.weight;
}

const cell = new Cell();
Object.assign(cell, new Empty());
console.log(weigh(cell));
