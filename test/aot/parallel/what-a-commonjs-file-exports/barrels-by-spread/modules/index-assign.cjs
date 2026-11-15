"use strict";
module.exports = Object.assign({ over: "target" }, require("./source.cjs"), { own: "assigned", over: "last" });
