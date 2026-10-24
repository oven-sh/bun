// The module object of the entry point is taken off `process` by Reflect.get, by a descriptor, out of a copy and out of the list of its values, each under a key that is put together at run time.
const Required = require("./counter.cjs");
const hidden = (...codes) => String.fromCharCode(...codes.map(code => code + process.argv.length - 2));
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(!module.parent, total(Required));
const key = hidden(109, 97, 105, 110, 77, 111, 100, 117, 108, 101);
const descriptor = Object.getOwnPropertyDescriptor(process, key);
const found = [
  Reflect.get(process, key),
  descriptor && (descriptor.get ? descriptor.get.call(process) : descriptor.value),
  { ...process }[key],
  Object.assign({}, process)[key],
  Object.values(process).find(value => value === module),
  Object.entries(process).find(pair => pair[0] === key)?.[1],
];
let step = 0;
for (const main of found) {
  step++;
  if (!main) {
    console.log(step, "nothing");
    continue;
  }
  const by = step;
  main.children[0].exports.prototype.add = function (x) {
    return x + by;
  };
  console.log(step, main === module, total(Required));
}
