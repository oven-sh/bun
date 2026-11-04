function A(v) { this.x = v; }
function B(v) { this.y = v; }
function get(h, i) { return h[i]; }
const seen = [A, B].map(h => get(h, [].length));
console.log(seen.join(), typeof new A(1).x, typeof new B("t").y);
