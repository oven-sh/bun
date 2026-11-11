'use strict';
const far = v => [v][JSON.parse('0')], turns = +(process.argv[2] || 300);
class H extends Map { hue() { return 1; } }
class K extends Map { constructor() { super(); this.n = 1; } kay() { return this.n + 1; } later() { this.z = 1; } }
const h = new H(), k = new K(); let sum = 0;
function f(b) { let n = 0; for (let i = 0; i < 16; i++) n += b.kay() | 0; return n; }
for (let t = 0; t < turns; t++) { Object.setPrototypeOf(h, K.prototype); sum += f(far(t & 1 ? h : k)); Object.setPrototypeOf(h, H.prototype); }
console.log(sum, k.kay());
