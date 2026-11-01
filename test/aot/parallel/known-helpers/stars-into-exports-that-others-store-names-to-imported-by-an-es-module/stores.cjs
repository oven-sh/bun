"use strict";
const attempt = work => {
  try {
    return work();
  } catch (error) {
    return error.constructor.name;
  }
};
exports.storeTag = target => attempt(() => (target.tag = "tag"));
exports.storeTwo = target => attempt(() => (target.two = "stored"));
exports.exportsOf = name => (name === "free" ? require("./free.cjs") : name === "bound" ? require("./bound.cjs") : require("./outer.cjs"));
