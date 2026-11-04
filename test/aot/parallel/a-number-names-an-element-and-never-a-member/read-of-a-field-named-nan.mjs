function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { NaN: { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(0 / zero);
console.log(typeof found, found === undefined ? "none" : found.a);
