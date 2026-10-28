// A generator requires files step by step.
const it = (function* () {
  const x = require("./x.cjs");
  yield x.v;
  const y = yield require("./y.cjs").v;
  return y;
})();
console.log("before");
console.log(it.next().value);
console.log("between");
console.log(it.next().value);
console.log(it.next(7).value);
