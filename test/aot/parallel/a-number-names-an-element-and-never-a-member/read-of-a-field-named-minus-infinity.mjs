function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { "-Infinity": { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(-1 / zero);
console.log(typeof found, found === undefined ? "none" : found.a);
