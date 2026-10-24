// Impostors narrowing and accessors: wg probes shrink  spread typed as the class. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

function weigh(c: Cell): number {
  return c.leaf === null ? -1 : c.leaf.weight;
}

const cell: Cell = { ...new Cell(), ...{ leaf: null } };
console.log(weigh(cell));
console.log(weigh(new Cell()));
