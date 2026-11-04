const o = { 0: "text", x: 1 };
const key = { [Symbol.toPrimitive]() { o.x = "changed"; return 0; } };
function get(h, k) { return h[k]; }
console.log(typeof get(o, 1), typeof get(o, key), typeof o.x);
