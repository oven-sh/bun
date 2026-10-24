// What one read of `module.children` puts into the list another read finds there.
const Required = require("./counter.cjs");
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
class Other {
  add(x) {
    return x + 0.25;
  }
}
console.log(module.children.length, module.children === module.children);
module.children.push({ exports: Other, id: 5 });
const last = module.children[module.children.length - 1];
console.log(module.children.length, typeof last.id, total(last.exports), total(module.children[0].exports), total(Required));
module.children.length = 0;
console.log(module.children.length, module.children[0]);
module.children.note = "kept";
console.log(module.children.note);
