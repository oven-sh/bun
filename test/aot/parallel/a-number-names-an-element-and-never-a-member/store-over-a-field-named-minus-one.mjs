function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "-1": 1, x: 2 };
function put(k, v) { o[k] = v; }
put(zero - 1, "text");
console.log(typeof o["-1"], typeof o.x, Object.keys(o).join());
