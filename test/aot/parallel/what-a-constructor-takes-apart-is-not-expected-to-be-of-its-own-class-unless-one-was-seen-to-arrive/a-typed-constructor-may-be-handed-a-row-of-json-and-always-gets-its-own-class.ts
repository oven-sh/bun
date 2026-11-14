interface Row { id: number; score: number; rank: number; weight: number }
const data = JSON.parse('{"rows":[{"id":0,"score":0.25,"rank":1,"weight":2}],"never":false}');
const rows: Row[] = data.rows; const never: boolean = data.never;
class Member { id: number; score: number; rank: number; weight: number; constructor(row: Row) { this.id = row.id; this.score = row.score; this.rank = row.rank; this.weight = row.weight; } }
const first = new Member(rows[0]!);
function f(t: number): number { let s = t & 1; let m = first; for (let i = 0; i < 64; i++) { m = new Member(never ? rows[0]! : m); s += m.id + m.score + m.rank + m.weight; } return s; }
const n = +(process.argv[2] ?? 3); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
export {};
