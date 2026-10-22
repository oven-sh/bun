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
