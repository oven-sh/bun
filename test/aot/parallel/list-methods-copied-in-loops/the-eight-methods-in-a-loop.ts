const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
interface Row { n: number; open: boolean }
function all(rows: Row[]): unknown[] { let sum = 0; rows.forEach(r => { sum += r.n; }); return [sum, rows.map(r => r.n * 2), rows.filter(r => r.open).length, rows.reduce((a, r) => a + r.n, 0), rows.some(r => r.n > 2), rows.every(r => r.open), rows.find(r => !r.open)?.n, rows.findIndex(r => r.n === 3)]; }
const rows: Row[] = []; for (let i = 0; i < 5; i++) rows.push({ n: i, open: (i & 1) === 0 });
for (let turn = 0; turn < 400; turn++) { said.length = 0; said.push(all(rows), all([]), all(JSON.parse('[{"n":3,"open":true}]'))); }
console.log(said.map(show).join(" "));
