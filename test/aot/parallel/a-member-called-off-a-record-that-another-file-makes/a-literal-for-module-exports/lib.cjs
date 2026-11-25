function add(a, b) { return a + b | 0; }
const low = (a) => a & 15;
module.exports = { add, low, rate: 3 };
