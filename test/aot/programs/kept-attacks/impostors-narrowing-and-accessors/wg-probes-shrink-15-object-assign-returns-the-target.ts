// Impostors narrowing and accessors: wg probes shrink  object assign returns the target. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const cell: Cell = Object.assign(new Cell(), { leaf: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
