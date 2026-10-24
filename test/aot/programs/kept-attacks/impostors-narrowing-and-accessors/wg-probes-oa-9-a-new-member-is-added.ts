// Impostors narrowing and accessors: wg probes oa  a new member is added. It prints what plain Bun prints.
class Cell {
  value = 1;
}

const cell = Object.assign(new Cell(), { extra: "added" });
const same: Cell & { extra?: string } = cell;
console.log(same.extra, Object.keys(cell).join(), "extra" in cell, cell.extra.length);
const plain: Cell & { extra?: string } = new Cell();
Object.assign(plain, { extra: "later" });
console.log(plain.extra === undefined ? "missing" : plain.extra.length, Object.keys(plain).join());
