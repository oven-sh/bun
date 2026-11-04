// one name in two classes
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
class Cell { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Vector { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } length() { return Math.sqrt(this.x * this.x + this.y * this.y); } scaled(by: number) { return new Vector(this.x * by, this.y * by); } }
const grid = [["a", "b", "c"], ["d", "e", "f"]];
function at(cell: Cell) { return grid[cell.y][cell.x]; }
let v = new Vector(3, 4); (globalThis as any).kept = v;
const said = [at(new Cell(2, 1)), String(v.length())];
for (let i = 0; i < 4; i++) { v = v.scaled(hidden<number>("0.5")); said.push(v.x + "," + v.y + "," + v.length()); }
console.log(said.join(" | "));
