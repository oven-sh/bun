const o = { 0: 1, x: 1 };
function bump(h, i) { h[i] += "text"; h[i + 1] ??= "new"; }
bump(o, [].length);
console.log(typeof o[0], o[0], o[1], typeof o.x);
