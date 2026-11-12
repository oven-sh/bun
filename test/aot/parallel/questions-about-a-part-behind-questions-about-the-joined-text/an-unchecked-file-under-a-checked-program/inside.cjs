"use strict";
module.exports = function relation(path, dir) {
  if (typeof path !== "string" || typeof dir !== "string") throw new TypeError("texts, please");
  if (path.startsWith(dir + "/")) return "inside";
  if (path.startsWith(dir)) return "beside";
  return "outside";
};
