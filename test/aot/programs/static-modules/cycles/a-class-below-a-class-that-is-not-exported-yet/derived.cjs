const Base = require("./base.cjs");
try {
  exports.Derived = class Derived extends Base {};
} catch (error) {
  exports.failure = error.constructor.name;
}
exports.define = () => {
  const Base = require("./base.cjs");
  return class Derived extends Base {
    name() {
      return "derived of " + super.name();
    }
  };
};
