// copies an object of twelve fields with a spread
type Row = { a: number; b: string; c: number; d: string; e: number; f: string; g: number; h: string; i: number; j: string; k: number; l: string };
const operations = 100;
const rows: Row[] = [];
for (let n = 0; n < operations; n++) rows.push({ a: n, b: "b", c: n, d: "d", e: n, f: "f", g: n, h: "h", i: n, j: "j", k: n, l: "l" });
let total = 0;

kernel: {
  for (let n = 0; n < rows.length; n++) rows[n] = { ...rows[n] };
  total += rows[7].k;
}

console.log(total);
