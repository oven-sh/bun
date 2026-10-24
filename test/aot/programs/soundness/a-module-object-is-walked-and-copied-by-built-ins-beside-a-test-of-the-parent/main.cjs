// The module object is walked and copied by built-ins, which read `children` and `parent` themselves.
const Required = require("./counter.cjs");
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
console.log(!module.parent, total(Required));
const names = [];
for (const name in module) names.push(name);
console.log(names.sort().join());
console.log(Object.keys(module).sort().join(), Object.getOwnPropertyNames(module).sort().join());
const copy = { ...module };
console.log(typeof copy.children, typeof copy.parent, typeof copy.exports);
const listed = Object.values(module).filter(Array.isArray).flat().filter(value => value && value.exports === Required);
for (const file of listed) file.exports.prototype.add = x => x + 0.5;
console.log(listed.length, total(Required));
