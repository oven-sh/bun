function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { 0: 1, x: 2 };
function put(k, v) { o[k] = v; }
put(-zero, "text");
console.log(typeof o[0], typeof o.x, Object.keys(o).join());
