export class B { constructor(x) { this.x = x; } }
export class D extends B { constructor(x, y) { super(x); this.y = y; } }
export class I extends D { }
export class Forwards extends D { constructor(...args) { super(...args); this.f = 1; } }
export class Keeps { constructor(a, ...rest) { this.a = a; this.rest = rest; } }
export function direct(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new D(i, 1); t += o.x + o.y; } return t; }
export function implicit(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new I(i, 1); t += o.x + o.y; } return t; }
export function forwards(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Forwards(i, 1); t += o.x + o.f; } return t; }
export function keeps(n) { let t = 0; for (let i = 0; i < n; i++) { const o = new Keeps(i, 1, 2); t += o.a + o.rest.length; } return t; }
