const o = { undefined: "text", 0: 1 };
function get(h, k) { return h[k]; }
console.log(typeof get(o, [].length), typeof get(o, [][0]));
