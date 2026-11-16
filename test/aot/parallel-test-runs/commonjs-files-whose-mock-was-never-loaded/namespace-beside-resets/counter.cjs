exports.count = 0;
exports.increment = () => {
  exports.count++;
  exports.last = exports.count;
};
