const held = require("./late-function.cjs");
exports.sawType = typeof held;
exports.heldLater = () => typeof held + " " + Object.keys(held).length;
exports.requiredLater = () => typeof require("./late-function.cjs") + " " + require("./late-function.cjs")();
