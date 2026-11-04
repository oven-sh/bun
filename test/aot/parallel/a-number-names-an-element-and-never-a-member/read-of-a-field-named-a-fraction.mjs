function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "1.5": { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(zero + 1.5);
console.log(typeof found, found === undefined ? "none" : found.a);
