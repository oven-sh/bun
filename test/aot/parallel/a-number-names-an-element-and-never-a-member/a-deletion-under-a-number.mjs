const o = { 0: 1, 1: 2, x: 3 };
function drop(h, i) { return delete h[i]; }
console.log(drop(o, [].length), typeof o[0], typeof o[1], Object.keys(o).join());
