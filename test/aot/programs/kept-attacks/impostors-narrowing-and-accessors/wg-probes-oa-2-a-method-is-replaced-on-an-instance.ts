// Impostors narrowing and accessors: wg probes oa  a method is replaced on an instance. It prints what plain Bun prints.
class Cell {
  value = 1;
  twice(): number {
    return this.value * 2;
  }
}

const cell = new Cell();
Object.assign(cell, { twice: () => 99 });
console.log(cell.twice(), new Cell().twice());
