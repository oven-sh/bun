const all = require("./second.mjs");
exports.use = function () {
  all.box.n += 1;
  return [all.count(), new all.Point(5).twice(), all.read()].join(" ");
};
