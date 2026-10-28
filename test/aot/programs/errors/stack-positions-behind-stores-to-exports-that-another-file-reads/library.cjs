const { show, id, Base } = require("./show.cjs");
module.exports.Empty = class Empty {};
`${{ toString: () => String(show("module.exports.A = class A {}")) }}`;
module.exports.Model = class Model {
  method() {}
};
`${{ toString: () => String(show("module.exports.A = a class with a method")) }}`;
exports.Second = class Second {
  method() {}
};
`${{ toString: () => String(show("exports.A = a class with a method")) }}`;
exports.Nameless = class {
  method() {}
};
`${{ toString: () => String(show("exports.A = a class without a name")) }}`;
exports.work = function () {
  return 1;
};
`${{ toString: () => String(show("exports.f = function")) }}`;
module.exports.run = function () {
  return 2;
};
`${{ toString: () => String(show("module.exports.f = function")) }}`;
module.exports.five = 5;
`${{ toString: () => String(show("module.exports.n = 5")) }}`;
module.exports.counted = id(1);
`${{ toString: () => String(show("module.exports.n = a call")) }}`;
module.exports.Derived = class Derived extends Base {
  size = 1;

  #hidden = 2;

  static count = id(2);

  static {
    id(3);
  }
};
`${{ toString: () => String(show("module.exports.A = a class with fields and static parts")) }}`;
exports.first = exports.second = 6;
`${{ toString: () => String(show("exports.a = exports.b = 6")) }}`;
exports.five += 1;
`${{ toString: () => String(show("exports.n += 1")) }}`;
