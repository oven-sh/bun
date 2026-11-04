"use strict";
const bus = require("./bus.cjs");
function ask() { const answers = []; bus.emit("look", answers); return answers.join(","); }
exports.first = ask();
exports.total = 41;
exports.second = ask();
