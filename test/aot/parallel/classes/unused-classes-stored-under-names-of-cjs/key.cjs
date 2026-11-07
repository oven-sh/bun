const key = {
  toString() {
    console.log("converted");
    return "name";
  },
};
exports.Unused = class {
  [key]() {}
};
exports.used = 1;
