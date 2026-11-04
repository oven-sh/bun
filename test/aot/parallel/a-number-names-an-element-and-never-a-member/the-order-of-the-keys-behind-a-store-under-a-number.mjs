const o = { b: 1, a: 2 };
function put(h, i, v) { h[i] = v; }
put(o, 2, "x"); put(o, [].length, "y"); put(o, -1, "z"); put(o, 1.5, "w");
console.log(Object.keys(o).join(), JSON.stringify(o));
