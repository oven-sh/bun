exports.value = [1];
exports.then = function (resolve) {
  resolve({ value: "from a CommonJS then" });
};
