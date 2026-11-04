const o = { x: 1, get 0() { this.x = "text"; return 7; } };
function get(i) { return o[i]; }
console.log(typeof o.x, get([].length), typeof o.x);
