// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `this` of a method stands in the default of a pattern, in a computed key of one, in the test of a `case`, in what a class extends: it is the receiver, and the file keeps its names.
const k = require("./k.cjs");
const c = new k.C();
console.log(k.n, c.m({}), c.m({ t: 2 }), c.first([]), c.keyed({ t: 9 }), c.parameter({}), c.kind(7), c.kind(8), new (c.below())().base);
console.log(k.plain(), k.top, k.match);

// FILE: k.cjs
exports.n = 1;
class Base {
  base = "base";
}
class C {
  constructor() {
    this.t = 7;
    this.key = "t";
    this.Base = Base;
  }
  m(o) {
    const { t = this.t } = o;
    return t;
  }
  first(list) {
    const [t = this.t] = list;
    return t;
  }
  keyed(o) {
    const { [this.key]: t } = o;
    return t;
  }
  parameter({ t = this.t }) {
    return t;
  }
  kind(k) {
    switch (k) {
      case this.t:
        return "same";
      default:
        return "other";
    }
  }
  below() {
    return class extends this.Base {};
  }
}
exports.C = C;
exports.plain = function () {
  return "plain";
};
// At the top `this` is the exports.
const { top = this.n } = {};
exports.top = top;
switch (1) {
  case this.n:
    exports.match = true;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
