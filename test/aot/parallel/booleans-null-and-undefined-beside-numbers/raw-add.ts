class Row {
    a: number | boolean | null;
    constructor(a: number | boolean | null) { this.a = a; }
}
const rows: Row[] = JSON.parse("[true,false,null,3,-0.5]").map((a: number | boolean | null) => new Row(a));
function plus(t: number, row: Row): number { const s = t * 0.5 + 1; return s + (row.a as number); }
function plusBack(t: number, row: Row): number { const s = t * 0.5 + 1; return (row.a as number) + s; }
function minus(t: number, row: Row): number { const s = t * 0.5 + 1; return s - (row.a as number); }
function minusBack(t: number, row: Row): number { const s = t * 0.5 + 1; return (row.a as number) - s; }
const n = Number(process.argv[2] ?? 3);
const out: string[] = [];
for (let t = -2; t < n; t++) {
    for (const row of rows) {
        let sum = t * 0.25;
        sum = sum + (row.a as number);
        out.push([plus(t, row), plusBack(t, row), minus(t, row), minusBack(t, row), sum].join());
    }
}
console.log(out.join("\n"));
