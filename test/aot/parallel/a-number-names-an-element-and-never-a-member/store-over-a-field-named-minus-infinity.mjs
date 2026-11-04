function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "-Infinity": 1, x: 2 };
function put(k, v) { o[k] = v; }
put(-1 / zero, "text");
console.log(typeof o["-Infinity"], typeof o.x, Object.keys(o).join());
