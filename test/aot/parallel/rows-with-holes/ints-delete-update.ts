// Under: --aot-testing=CheckBoundsAtRunTime: every access to an element is checked against its array
const grid: number[][] = [];
for (let y = 0; y < 6; y++) { const row: number[] = []; for (let x = 0; x < 6; x++) row.push((y * 7 + x * 3) & 255); grid.push(row); }
const other: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
function run(grid: number[][], other: number[], rows: number, columns: number, factor: number): number {
  let total = 0;
  for (let y = 1; y < rows; y++) {
    for (let x = 1; x < columns; x++) {
      grid[y]![x] = (grid[y]![x]! + 1) & 255;
    }
  }
  return total;
}
function show(list: any): string { if (!Array.isArray(list)) return String(list); let s = ""; for (let i = 0; i < Math.min(list.length, 14); i++) s += (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole") + ","; return s + list.length; }
function showAll(): string { let s = ""; for (let i = 0; i < 8; i++) s += show(grid[i]) + " | "; return s + show(other); }
for (let round = 0; round < 3; round++) {
  if (round === 1) { try { delete (grid[2] as any)[3]; delete (grid[3] as any)[0]; } catch (e: any) { console.log(e.constructor.name); } }
  for (const columns of [5, 6, 3]) {
    let line: string;
    try { line = String(run(grid, other, 5, columns, 3)); } catch (e: any) { line = e.constructor.name; }
    console.log(round, columns, line, showAll());
  }
}
