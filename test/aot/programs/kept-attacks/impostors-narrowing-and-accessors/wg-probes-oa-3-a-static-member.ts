// Impostors narrowing and accessors: wg probes oa  a static member. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  static shared: Leaf | null = new Leaf();
}

Object.assign(Cell, { shared: null });
console.log(Cell.shared === null ? -1 : Cell.shared.weight);
