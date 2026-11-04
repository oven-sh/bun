const o = { 0: "text", x: 1 };
function get(h, k) { return h[k]; }
console.log(typeof get(o, 1), typeof get(o, new Number(0)));
