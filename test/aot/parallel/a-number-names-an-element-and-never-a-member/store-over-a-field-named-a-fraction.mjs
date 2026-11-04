function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "1.5": 1, x: 2 };
function put(k, v) { o[k] = v; }
put(zero + 1.5, "text");
console.log(typeof o["1.5"], typeof o.x, Object.keys(o).join());
