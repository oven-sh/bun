// Impostors narrowing and accessors: wg probes shrink  a partial patch. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
  count = 1;
  update(patch: Partial<Cell>): void {
    Object.assign(this, patch);
  }
  weigh(): number {
    return this.leaf === null ? -1 : this.leaf.weight;
  }
}

const cell = new Cell();
cell.update({ count: 2 });
console.log(cell.weigh(), cell.count);
cell.update({ leaf: null });
console.log(cell.weigh(), cell.count);
