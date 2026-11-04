const o = { 0: "text", x: 1 };
function get(h, k) { return h[k]; }
function put(h, k, v) { h[k] = v; }
put(o, 1n, 5);
console.log(typeof get(o, 0n), typeof o[1], Object.keys(o).join());
