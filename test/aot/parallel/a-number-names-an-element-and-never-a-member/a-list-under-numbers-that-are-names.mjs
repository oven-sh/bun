const l = [1];
function put(h, i, v) { h[i] = v; }
function get(h, i) { return h[i]; }
for (const i of [-1, 1.5, 0 / [].length, 2 ** 32, 4294967295]) put(l, i, "text");
console.log(l.length, Object.keys(l).join(), typeof get(l, -1), typeof get(l, [].length));
