function f() {}
function g() {}
function put(h, i, v) { h[i] = v; }
for (const h of [f, g]) put(h, [].length, "text");
console.log(typeof f[0], typeof g[0], Object.keys(f).join());
