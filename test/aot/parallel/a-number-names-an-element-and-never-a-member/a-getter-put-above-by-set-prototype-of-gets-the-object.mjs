const above = { get 0() { this.x = "text"; return 7; } };
const o = { x: 1 };
Object.setPrototypeOf(o, above);
function get(h, i) { return h[i]; }
console.log(typeof o.x, get(o, [].length), typeof o.x);
