// Impostors narrowing and accessors: wg probes oa  a getter in the source. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const cell = new Cell();
Object.assign(cell, {
  get leaf(): null {
    return null;
  },
});
console.log(cell.leaf === null ? -1 : cell.leaf.weight);
