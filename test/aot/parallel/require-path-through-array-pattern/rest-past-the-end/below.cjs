function idle() {}
const [a, b, ...[c]] = ["./part.cjs"];
console.log(a, b, c);
require(c ?? "./other.cjs");
