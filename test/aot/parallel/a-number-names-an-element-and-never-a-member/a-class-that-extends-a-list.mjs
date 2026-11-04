class P { v = 1; }
class L extends Array { x = 1; }
const l = new L;
l.push(new P);
function get(h, i) { return h[i]; }
const found = get(l, [].length);
found.v = "text";
console.log(typeof found, typeof l[0].v, l.length);
