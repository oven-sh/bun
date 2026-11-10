// STATISTIC: StoresUnderRawNumbersByStubOfLists >= 1
class Board { cells: (string | null)[] = []; constructor() { for (let i = 0; i < 8; i++) this.cells.push(null); } move(to: number, piece: string): void { this.cells[to] = piece; } }
const b = new Board(); b.move(Number("3"), "k"); b.move(Number("2.5"), "x"); b.move(9, "y");
console.log(b.cells.length, b.cells.join(), Object.keys(b.cells).join());
export {};
