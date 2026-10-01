// DRAFT (see eslint-side.cjs). The names of the rules that are "error" in eslint:recommended at the pin.
"use strict";
const path = require("path");
const { ESLINT } = require("./eslint-side.cjs");
const conf = require(path.join(ESLINT, "packages/js/src/configs/eslint-recommended.js"));
module.exports = Object.keys(conf.rules).filter(r => conf.rules[r] === "error" || conf.rules[r] === 2).sort();
if (require.main === module) console.log(module.exports.length, module.exports.join(" "));
