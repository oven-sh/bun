class P { v = 1; }
const above = [new P];
const o = { x: 1 };
Object.setPrototypeOf(o, above);
function get(h, i) { return h[i]; }
const found = get(o, [].length);
found.v = "text";
console.log(typeof found, typeof above[0].v);
