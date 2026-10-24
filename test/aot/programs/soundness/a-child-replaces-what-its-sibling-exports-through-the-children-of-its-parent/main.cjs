// second.cjs goes from its parent to the list of children and replaces what counter.cjs exports, and a method of the class that it exported. The next require of counter.cjs answers what lies there.
const Required = require("./counter.cjs");
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(total(Required));
require("./second.cjs");
const Again = require("./counter.cjs");
console.log(Again === Required, total(Required), total(Again), typeof exports.added);
