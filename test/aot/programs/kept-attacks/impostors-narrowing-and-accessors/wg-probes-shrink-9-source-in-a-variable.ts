// Impostors narrowing and accessors: wg probes shrink  source in a variable. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

function weigh(c: Cell): number {
  return c.leaf === null ? -1 : c.leaf.weight;
}

const cell = new Cell();
const source = { leaf: null };
Object.assign(cell, source);
console.log(weigh(cell));
