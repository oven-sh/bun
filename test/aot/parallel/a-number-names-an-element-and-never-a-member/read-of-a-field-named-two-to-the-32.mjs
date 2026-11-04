function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { 4294967296: { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(2 ** 32 + zero);
console.log(typeof found, found === undefined ? "none" : found.a);
