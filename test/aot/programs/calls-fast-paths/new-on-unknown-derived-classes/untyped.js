export class B { constructor(x) { this.x = x; } }
export class D extends B { constructor(x) { super(x); this.y = 1; } }
export class E extends D { constructor(x) { super(x); this.z = 2; } }
export class Implicit extends D { }
export function F(x) { this.x = x; }
export function make(table, which, n) { const C = table[which]; let s = 0; for (let i = 0; i < n; i++) s += new C(i & 7).x; return s; }
