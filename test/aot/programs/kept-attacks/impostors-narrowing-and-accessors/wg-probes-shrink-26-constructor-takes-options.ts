// Impostors narrowing and accessors: wg probes shrink  constructor takes options. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
  constructor(options: { leaf?: Leaf | null } = {}) {
    Object.assign(this, options);
  }
}

const cell = new Cell({ leaf: null });
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
console.log(new Cell().leaf === null);
