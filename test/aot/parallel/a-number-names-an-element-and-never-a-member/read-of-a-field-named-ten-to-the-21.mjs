function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "1e+21": { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(1e21 + zero);
console.log(typeof found, found === undefined ? "none" : found.a);
