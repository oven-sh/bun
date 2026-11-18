'use strict';
const far = v => [v][JSON.parse('0')], turns = +(process.argv[2] || 300);
class H extends Map { constructor(t) { super(); this.n = 1; if (t) this.ttl = t; } two() { return this.n + (this.ttl ?? 0); } }
const a = new H(4), b = new H(0); Object.defineProperty(b, 'ttl', { get() { return 9; }, configurable: true }); let sum = 0;
function f(x) { let n = 0; for (let i = 0; i < 16; i++) n += x.two(); return n; }
for (let t = 0; t < turns; t++) sum += f(far(t & 1 ? a : b));
console.log(sum, new H(0).two());
