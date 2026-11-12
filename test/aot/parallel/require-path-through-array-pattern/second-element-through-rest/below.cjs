function idle() {}
const [, ...[second]] = ["./part.cjs", "./other.cjs"];
console.log(second);
require(second);
