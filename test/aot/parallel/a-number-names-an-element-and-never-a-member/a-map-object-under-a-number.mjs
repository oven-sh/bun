const m = new Map;
function put(h, i, v) { h[i] = v; }
function get(h, i) { return h[i]; }
put(m, [].length, "text");
console.log(typeof get(m, [].length), m.size, Object.keys(m).join());
