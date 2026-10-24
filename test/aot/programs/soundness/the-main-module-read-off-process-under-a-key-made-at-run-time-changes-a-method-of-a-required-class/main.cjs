// The file asks whether it has a parent. The module object of the entry point is read off `process` under a key that is put together at run time, and through its children a method of the required class is replaced.
const Required = require("./counter.cjs");
const hidden = (...codes) => String.fromCharCode(...codes.map(code => code + process.argv.length - 2));
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(!module.parent, total(Required));
const main = process[hidden(109, 97, 105, 110, 77, 111, 100, 117, 108, 101)];
main.children[0].exports.prototype.add = function (x) {
  return x + 0.5;
};
main.children[0].exports.label = 7;
console.log(main === module, total(Required), Required.label);
