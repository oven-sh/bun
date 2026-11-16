"use strict";
let held;
exports.keep = function () { held = this; };
exports.kept = () => held;
