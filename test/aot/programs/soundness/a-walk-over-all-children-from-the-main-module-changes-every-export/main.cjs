// deep.cjs walks from require.main over all the children and changes what each file exports.
const Required = require("./counter.cjs");
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
exports.label = "main";
const middle = require("./middle.cjs");
console.log(total(Required), Required.label, middle.label, exports.label, middle.double(4));
middle.walk();
console.log(total(Required), Required.label, middle.label, exports.label, middle.double(4));
