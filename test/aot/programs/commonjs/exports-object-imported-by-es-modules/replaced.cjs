exports.lost = 1;
module.exports = function replaced() {
  return "called";
};
module.exports.member = "member";
module.exports.original = exports;
