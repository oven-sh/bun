let calls = 0;
exports.limit = 5;
exports.bump = n => (calls += n);
function read() {
  let sum = 0;
  for (let round = 0; round < 100; round++) sum += exports.limit;
  return sum;
}
const before = read();
require("./child.cjs");
exports.report = () => [before, read(), calls].join();
