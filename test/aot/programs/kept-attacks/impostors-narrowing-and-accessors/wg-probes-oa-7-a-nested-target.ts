// Impostors narrowing and accessors: wg probes oa  a nested target. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

class Outer {
  cell = new Cell();
}

const outer = new Outer();
Object.assign(outer.cell, { leaf: null });
console.log(outer.cell.leaf === null ? -1 : outer.cell.leaf.weight);
