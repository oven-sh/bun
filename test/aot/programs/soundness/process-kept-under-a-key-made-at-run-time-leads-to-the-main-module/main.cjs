// `process` lies in an object under a key that is put together at run time, and what is read back is asked for `mainModule` by name.
const Required = require("./counter.cjs");
const hidden = (...codes) => String.fromCharCode(...codes.map(code => code + process.argv.length - 2));
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(!module.parent, total(Required));
const box = { a: 1, b: "two" };
box[hidden(112, 114, 111, 99, 101, 115, 115)] = process;
const main = box[hidden(112, 114, 111, 99, 101, 115, 115)].mainModule;
main.children[0].exports.prototype.add = function (x) {
  return x + 0.5;
};
console.log(main === module, total(Required));
