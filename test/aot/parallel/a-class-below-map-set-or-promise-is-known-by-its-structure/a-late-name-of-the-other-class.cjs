'use strict';
const far = v => [v][JSON.parse('0')], turns = +(process.argv[2] || 300);
class H extends Map { mark() { this.m = 5; } hue() { return 1; } }
class K extends Map { note() { this.q = 7; } kay() { return (this.q ?? 3) + (this.m ?? 0); } }
const h = new H(), k = new K(); h.mark(); k.note(); let sum = 0;
function f(a, b) { let n = 0; for (let i = 0; i < 16; i++) { n += a.hue() - 1; Object.setPrototypeOf(a, K.prototype); n += b.kay(); Object.setPrototypeOf(a, H.prototype); } return n; }
for (let t = 0; t < turns; t++) sum += f(far(h), far(h));
console.log(sum, k.kay());
