function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "1e+21": 1, x: 2 };
function put(k, v) { o[k] = v; }
put(1e21 + zero, "text");
console.log(typeof o["1e+21"], typeof o.x, Object.keys(o).join());
