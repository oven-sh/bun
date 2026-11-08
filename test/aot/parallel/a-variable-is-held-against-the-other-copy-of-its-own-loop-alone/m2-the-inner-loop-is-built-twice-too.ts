const n = (value: number) => Number(process.argv[8] ?? value);
let ticks = 0; let pos: any = 0;
function run(rows: number, list: any[]): number { let sum = 0; for (let r = 0; r < rows; r++) { ticks++; pos = r; for (let c = 0; c < list.length; c++) { pos += list[c]; sum += c; } } return sum; }
(globalThis as any).kept = run;
console.log(run(n(4), [1, 2, n(3)]), ticks, pos, run(n(4), [1, "x", 2, 0.5]), ticks, pos);
