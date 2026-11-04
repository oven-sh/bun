class P { v = 1; }
const above = { 0: new P };
const o = Object.create(above);
o.x = 1;
function get(h, i) { return h[i]; }
const found = get(o, [].length);
found.v = "text";
console.log(typeof found, typeof above[0].v);
