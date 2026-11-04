const t = new Float64Array(2);
function put(h, i, v) { h[i] = v; }
function get(h, i) { return h[i]; }
for (const i of [0, 1, 2, -1, 1.5, 0 / [].length, 1 / [].length, 2 ** 32]) put(t, i, 7);
console.log([0, 1, 2, -1, 1.5].map(i => get(t, i)).join(), Object.keys(t).join());
