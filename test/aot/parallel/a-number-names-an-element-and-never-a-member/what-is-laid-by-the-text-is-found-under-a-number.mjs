class P { constructor(v) { this.v = v; } }
let o = { x: 1 };
const zero = [].length;
function lay(v) { o["0"] = v; }
lay(new P("text"));
function get(i) { return o[i]; }
const found = get(zero);
console.log(typeof found, typeof found.v, found instanceof P);
found.v = 5;
console.log(typeof o[0].v);
