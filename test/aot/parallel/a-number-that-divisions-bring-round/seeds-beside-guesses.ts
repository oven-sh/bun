class Cell { constructor(public v: number) {} }
function run(cells: Cell[], x: number): string { let t = 0; for (let i = 0; i < cells.length; i++) { x = (x * 5 + cells[i].v) % 17; t += x; } return (Object.is(x, -0) ? "-0" : x) + " " + t; }
const cells = [new Cell(1), new Cell(2), new Cell(3)];
let s = ""; for (let r = 0; r < 200; r++) s = run(cells, 3);
console.log(s, "|", run(cells, 0.5), "|", run(cells, -1), "|", run(cells, 2 ** 31), "|", run(cells, 1700000000000), "|", run(cells, NaN), "|", run([], -0), "|", run([new Cell(0)], -0), "|", run([new Cell(5)], -1));
