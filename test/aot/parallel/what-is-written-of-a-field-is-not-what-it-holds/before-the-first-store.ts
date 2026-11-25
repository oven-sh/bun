const unseen = (x: any): any => [x][JSON.parse("0")];
function take(n: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof n + ":" + String(n) + work; }
class Early { n: number; seen: string; constructor() { this.seen = kind(this); this.n = 7; } }
function kind(e: Early): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return take(e.n); }
const e = new Early(); console.log(e.seen, kind(e));
