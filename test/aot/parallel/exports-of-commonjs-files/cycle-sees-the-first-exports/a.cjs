"use strict";
exports.half = true;
const b = require("./b.cjs");
module.exports = function whole(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "whole" + n + typeof b.early; };
