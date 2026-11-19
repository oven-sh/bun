let above;
try {
  above = require("./above.cjs");
} catch {
  above = require("./above.cjs");
}
const kept = require("./kept.cjs");
const [again, listed] = module.children;
const failed = listed.parent;
console.log(above.four, kept.three, module.children.length, failed === again, failed.id === again.id);
console.log(Object.keys(failed.exports).join(), Object.keys(again.exports).join(), failed.loaded, failed.parent === module);
console.log(failed.children.length, failed.children[0] === listed, again.children.length, again.children[0] === listed);
