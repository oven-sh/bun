globalThis.log.push("changes-file");
exports.value = 1;
exports.change = () => {
  exports.value = 2;
};
