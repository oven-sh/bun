// loops stand inside loops under one handler, one of them never turns, and one adds fields to objects: every sum and every object is as plain Bun leaves it, and a long run can still be collected
class Cell { declare extra?: number; value: number; constructor(value: number) { this.value = value; } }
function subject(n: number, cells: Cell[]) { let sum = 0; try { for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) sum += j; do { sum += 1; } while (false); for (let k = 0; k < cells.length; k++) { cells[k].extra = i; sum += cells[k].value; } } } catch (e) { return "caught"; } return String(sum); }
function deed(n: number, size: number) { const cells: Cell[] = []; for (let i = 0; i < size; i++) cells.push(new Cell(i)); return subject(n, cells) + (size ? JSON.stringify(cells[size - 1]) : ""); }
console.log(deed(0, 0));
console.log(deed(1, 1));
console.log(deed(5, 3));
console.log(deed(200, 10));
Bun.gc(true);
console.log(deed(3, 2));
