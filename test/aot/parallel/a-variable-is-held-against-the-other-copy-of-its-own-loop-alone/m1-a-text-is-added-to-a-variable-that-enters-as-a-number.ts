const n = (value: number) => Number(process.argv[8] ?? value);
let s: any = 0;
function run(turns: number): void { for (let i = 0; i < turns; i++) s += "x"; }
function both(rows: number, cols: number): number { let seen = 0; for (let r = 0; r < rows; r++) { s = r; for (let c = 0; c < cols; c++) { s += c < 2 ? 1 : "y"; seen++; } } return seen; }
(globalThis as any).kept = [run, both];
run(n(3)); console.log(s); s = 1; run(n(0)); console.log(s, both(n(3), n(4)), s);
