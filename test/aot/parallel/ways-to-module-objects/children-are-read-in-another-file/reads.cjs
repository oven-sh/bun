"use strict";
require("./given.cjs");
require("./symbols.cjs");
exports.seen = [module.children.length, module.children.map((it) => typeof it.exports).join(), typeof module.parent].join(" ");
