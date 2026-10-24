// Impostors narrowing and accessors: wg probes shrink  this in a method. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
  reset(): void {
    Object.assign(this, { leaf: null });
  }
  weigh(): number {
    return this.leaf === null ? -1 : this.leaf.weight;
  }
}

const cell = new Cell();
console.log(cell.weigh());
cell.reset();
console.log(cell.weigh());
