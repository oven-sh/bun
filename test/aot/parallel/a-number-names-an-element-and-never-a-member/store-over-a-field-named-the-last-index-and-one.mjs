function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { 4294967295: 1, x: 2 };
function put(k, v) { o[k] = v; }
put(4294967295 + zero, "text");
console.log(typeof o[4294967295], typeof o.x, Object.keys(o).join());
