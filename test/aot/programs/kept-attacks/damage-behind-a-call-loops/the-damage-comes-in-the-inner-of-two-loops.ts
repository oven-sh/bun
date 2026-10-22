// Two nested loops read the fields of one object. The test of the object can stand in front of both. A call in the inner loop deletes one field at one point, and both loops go on reading.
class Grid {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

let strikes = false;
function cell(grid: Grid, row: number, column: number): number {
  if (strikes && row === 1 && column === 1) delete (grid as any).width;
  return row * 10 + column;
}

function scan(grid: Grid): string {
  let text = "";
  for (let row = 0; row < grid.height; row++) {
    for (let column = 0; column < 3; column++) {
      text += cell(grid, row, column) + ":" + grid.width + " ";
    }
    text += "/" + grid.width + "/" + grid.height + " ";
  }
  return text;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = scan(new Grid(round, 3));
  if (strikes || round === 0) console.log(round + ": " + line);
}
