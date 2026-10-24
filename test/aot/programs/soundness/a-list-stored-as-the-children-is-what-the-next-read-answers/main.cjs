// `module.children = ..` replaces the list.
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
const before = module.children;
module.children = [{ exports: Other }];
console.log(before.length, module.children.length, before === module.children, total(module.children[0].exports), total(before[0].exports), total(Required));
module.children = 5;
console.log(typeof module.children);
