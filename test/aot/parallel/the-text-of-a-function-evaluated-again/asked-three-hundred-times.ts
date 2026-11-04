// The text is asked for, evaluated and constructed three hundred times.
class Cell { constructor(public row: number, readonly column = row + 1) {} sum() { return this.row + this.column; } }
let total = 0;
let lengths = new Set<number>();
for (let round = 0; round < 300; round++) {
  const text = String(Cell);
  lengths.add(text.length);
  const Again = (0, eval)("(" + text + ")");
  total += new Again(round).sum() + new Cell(round).sum();
}
console.log(total, lengths.size);
