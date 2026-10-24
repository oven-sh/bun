// Methods found through instances: Object.freeze, Object.seal and Object.preventExtensions are native code that changes what a store into a typed instance does: it throws a TypeError in strict code and leaves the field as it was.
class Cell {
  value = 1;
  set(value: number): string {
    try {
      this.value = value;
      return "stored " + this.value;
    } catch (error) {
      return (error as Error).name + " " + this.value;
    }
  }
  grow(): string {
    try {
      (this as any).extra = 1;
      return "grew";
    } catch (error) {
      return (error as Error).name;
    }
  }
}

const cells = [new Cell(), Object.freeze(new Cell()), Object.seal(new Cell()), Object.preventExtensions(new Cell()), Object.defineProperty(new Cell(), "value", { writable: false })];
const frozenLate = new Cell();
[frozenLate].forEach(Object.freeze);
cells.push(frozenLate);
console.log(cells.map(cell => cell.set(2) + "/" + cell.grow()).join(" "));
