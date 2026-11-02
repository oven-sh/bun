exports.default = function greet(name) {
  return "hello " + name + " " + (this === undefined);
};
