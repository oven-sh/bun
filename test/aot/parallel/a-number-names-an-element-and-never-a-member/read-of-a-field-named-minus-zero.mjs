function zeroOf(list) { return list.length; }
const zero = zeroOf([]);
const o = { 0: { a: 1 }, x: 2 };
function get(k) { return o[k]; }
const found = get(-zero);
console.log(typeof found, found === undefined ? "none" : found.a);
