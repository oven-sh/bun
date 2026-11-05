function helper() { return "a static helper"; }

module.exports = class {
  method() { return "the class is the module"; }
  static helper() { return helper(); }
};
