interface Row { id: number; score: number }
const data = JSON.parse('{"rows":[{"id":0,"score":0.25},{"id":1,"score":1.5},{"id":2,"score":3},{"id":3,"score":4.75}]}');
const rows: Row[] = data.rows;
class Member { id: number; score: number; constructor(row: Row) { this.id = row.id; this.score = row.score; } }
function f(t: number): number { let s = t & 1; for (let i = 0; i < 64; i++) { const m = new Member(new Member(rows[i & 3]!)); s += m.id + m.score; } return s; }
const n = +(process.argv[2] ?? 3); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
export {};
