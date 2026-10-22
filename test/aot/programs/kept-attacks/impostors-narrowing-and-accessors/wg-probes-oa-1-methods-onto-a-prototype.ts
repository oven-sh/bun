// Impostors narrowing and accessors: wg probes oa  methods onto a prototype. It prints what plain Bun prints.
class Cell {
  value = 1;
}

interface Cell {
  twice(): number;
}

Object.assign(Cell.prototype, {
  twice(this: Cell): number {
    return this.value * 2;
  },
});

console.log(new Cell().twice());
