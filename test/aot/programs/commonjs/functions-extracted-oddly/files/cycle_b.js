const { fromTheCycle } = require("./cycle_a.js");
exports.callsWhatItTookOut = function () {
  try {
    return fromTheCycle();
  } catch (e) {
    return "threw " + e.name + " in the other module";
  }
};
