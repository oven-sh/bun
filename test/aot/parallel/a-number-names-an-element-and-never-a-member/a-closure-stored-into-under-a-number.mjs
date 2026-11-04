function make() { return function () {}; }
const f = make(), g = make();
function put(h, i, v) { h[i] = v; }
put(f, [].length, "text");
console.log(typeof f[0], typeof g[0], Object.keys(f).join(), Object.keys(g).join());
