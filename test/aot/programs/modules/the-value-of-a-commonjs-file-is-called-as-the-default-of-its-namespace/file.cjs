module.exports = function () {
  return Object.keys(this).join() + " " + this.value + " " + (this.default === module.exports);
};
module.exports.value = 1;
