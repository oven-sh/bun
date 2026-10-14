export class B { constructor(x) { this.x = x; } }
export class P extends B { constructor(x, y) { super(x); this.y = y; } }
export class Q extends P { constructor(x, y, z) { super(x, y); this.z = z; } }
export class R extends Q { constructor(x, y, z, w) { super(x, y, z); this.w = w; } }
export function two(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new P(i, 1); t += o.x + o.y; } return t; }
export function three(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Q(i, 1, 2); t += o.x + o.y + o.z; } return t; }
export function four(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new R(i, 1, 2, 3); t += o.x + o.w; } return t; }
