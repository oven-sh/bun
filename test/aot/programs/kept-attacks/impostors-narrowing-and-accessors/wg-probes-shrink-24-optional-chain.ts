// Impostors narrowing and accessors: wg probes shrink  optional chain. It prints what plain Bun prints.
class Leaf {
  weight = 7;
}

class Cell {
  leaf: Leaf | null = new Leaf();
}

const cell = new Cell();
Object.assign(cell, { leaf: null });
console.log(cell.leaf?.weight, cell.leaf ?? "nothing", cell.leaf ? "truthy" : "falsy", cell.leaf === null);
