const { early, late, missing = "default", late: renamed = "default for late" } = require("./b.cjs");
exports.saw = [early, late, missing, renamed].join();
exports.again = () => {
  const { late } = require("./b.cjs");
  return late;
};
