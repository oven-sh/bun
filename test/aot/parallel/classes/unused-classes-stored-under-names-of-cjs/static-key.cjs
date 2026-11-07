const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
exports.Unused = class {
  static [key]() {}
};
exports.used = 1;
