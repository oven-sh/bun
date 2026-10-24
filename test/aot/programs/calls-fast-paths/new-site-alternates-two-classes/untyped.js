export class K1 { constructor(x) { this.x = x; } }
export class K2 { constructor(x) { this.x = x + 1; } }
export class K3 { constructor(x) { this.x = x + 2; } }
export function byTurns(a, b, n) { let s = 0; for (let i = 0; i < n; i++) { const F = i & 1 ? a : b; s += new F(1).x; } return s; }
export function one(a, n) { let s = 0; for (let i = 0; i < n; i++) s += new a(1).x; return s; }
