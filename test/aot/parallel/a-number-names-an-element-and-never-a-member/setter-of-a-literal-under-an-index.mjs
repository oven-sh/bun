const o = { x: 1, set 0(v) { this.x = v; } };
function put(i, v) { o[i] = v; }
put([].length, "text");
console.log(typeof o.x, Object.keys(o).join());
