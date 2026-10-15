const b = require("./cycle_b.js");
exports.fromTheCycle = function () {
  return "from the cycle";
};
exports.seenEarly = function () {
  return b.callsWhatItTookOut();
};
