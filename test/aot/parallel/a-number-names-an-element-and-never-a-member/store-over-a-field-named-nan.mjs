function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { NaN: 1, x: 2 };
function put(k, v) { o[k] = v; }
put(0 / zero, "text");
console.log(typeof o[NaN], typeof o.x, Object.keys(o).join());
