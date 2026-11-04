class L extends Array { x = 1; }
const l = new L;
function put(h, i, v) { h[i] = v; }
put(l, [0, 0].length, "text");
console.log(l.length, typeof l[2], typeof l.x);
