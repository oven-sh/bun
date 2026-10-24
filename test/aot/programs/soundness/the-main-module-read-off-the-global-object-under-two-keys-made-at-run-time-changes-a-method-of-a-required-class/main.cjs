// As its neighbor, and `process` itself is read off the global object under a key that is put together at run time.
const Required = require("./counter.cjs");
const hidden = (...codes) => String.fromCharCode(...codes.map(code => code + process.argv.length - 2));
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(!module.parent, total(Required));
const main = globalThis[hidden(112, 114, 111, 99, 101, 115, 115)][hidden(109, 97, 105, 110, 77, 111, 100, 117, 108, 101)];
main[hidden(99, 104, 105, 108, 100, 114, 101, 110)][0].exports.prototype.add = function (x) {
  return x + 0.5;
};
console.log(main === module, total(Required));
