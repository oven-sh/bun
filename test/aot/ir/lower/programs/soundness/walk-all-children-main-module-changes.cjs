// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4
// CHECK-LABEL: function {{*}}name="total"

// FILE: main.cjs
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

// FILE: counter.cjs
module.exports = class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
};
module.exports.label = "first";

// FILE: deep.cjs
module.exports = function walk() {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    file.exports.label = seen.size;
    if (file.exports.double) file.exports.double = x => x + "!";
    if (file.exports.prototype?.add) file.exports.prototype.add = x => x + 0.5;
    for (const child of file.children) visit(child);
  };
  visit(require.main);
};

// FILE: middle.cjs
exports.label = "middle";
exports.double = x => x * 2;
exports.walk = require("./deep.cjs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
