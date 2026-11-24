// The inner loop reads one row, under a written position, and the outer loop reads a number beside it.
const outside: any = globalThis;
const numberOf = (value: number): number => Number(outside.missing ?? value);
function fill(turns: number) {
  const base = { label() { return "base"; } };
  const shelf = Object.create(base);
  shelf.bins = [[1, 2, 3], [4, 5, 6]]; shelf.scale = 7; shelf.size = { width: 3 };
  let total = 0;
  for (let round = 0; round < turns; round++) {
    const scale = shelf.scale;
    for (let i = 0; i < turns; i++) {
      const row = shelf.bins[1]; row[i] = i * scale; total += row[0];
    }
  }
  return total;
}
const functions = [fill];
console.log(functions[numberOf(0)](numberOf(9)), functions[numberOf(0)](numberOf(4)));
