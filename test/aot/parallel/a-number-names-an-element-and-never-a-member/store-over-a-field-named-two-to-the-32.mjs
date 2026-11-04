function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { 4294967296: 1, x: 2 };
function put(k, v) { o[k] = v; }
put(2 ** 32 + zero, "text");
console.log(typeof o[4294967296], typeof o.x, Object.keys(o).join());
