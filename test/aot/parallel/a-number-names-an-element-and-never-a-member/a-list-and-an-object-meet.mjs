class P { v = 1; }
const list = [new P];
const o = { 0: "text", x: 1 };
function get(h, i) { return h[i]; }
console.log(typeof get(list, [].length), typeof get(o, [].length), typeof o.x);
