const n = (value: number) => Number(process.argv[8] ?? value);
function make() { let a = 0, b: any = 0, c = 0; return { run(rows: number, cols: number, mark: any) { for (let r = 0; r < rows; r++) { a++; b = a; for (let k = 0; k < cols; k++) { c++; b = k < 2 ? b + 1 : mark; } } return [a, b, c].join(); } }; }
const m = make(); (globalThis as any).kept = m;
console.log(m.run(n(5), n(4), JSON.parse('"x"')), m.run(n(2), n(2), 0.5), m.run(n(3), n(3), undefined));
