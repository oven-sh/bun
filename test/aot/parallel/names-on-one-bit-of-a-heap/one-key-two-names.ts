class Pair { a: number; b: number; late?: number; constructor(n: number) { this.a = n; this.b = n + 1; } }
function write(o: Pair, p: Pair, v: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const a = o.a; p.a = v; return a + o.a; }
function add(o: Pair, p: Pair, v: number) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const before = o.late; p.late = v; return String(before) + " " + o.late; }
const q = new Pair(JSON.parse("5")); console.log(write(q, q, 10), add(q, q, 9));
