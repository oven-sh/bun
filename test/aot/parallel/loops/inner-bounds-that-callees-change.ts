// The bound of an inner loop is a field that a function called in the loop makes smaller.
class Table {
  width: number;
  cells: number[];
  constructor(cells: number[]) {
    this.width = 3;
    this.cells = cells.slice();
  }
}

function shrink(table: Table): number {
  table.width--;
  return 1;
}

function countCells(table: Table, cells: number[]): number {
  let sum = 0;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < table.width; column++) {
      sum += cells[column];
      sum += shrink(table);
    }
  }
  return sum;
}

function countFor(size: number): string {
  const cells: any = Array.from({ length: size }, (_: any, i: number) => i + 1);
  const table: any = new Table(cells);
  return countCells(table, cells) + " " + table.width;
}

console.log(countFor(8));
console.log(countFor(12));

export {};
