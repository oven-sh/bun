function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "1e-7": 1, x: 2 };
function put(k, v) { o[k] = v; }
put(1e-7 + zero, "text");
console.log(typeof o["1e-7"], typeof o.x, Object.keys(o).join());
