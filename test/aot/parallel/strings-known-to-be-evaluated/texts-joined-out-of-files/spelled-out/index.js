"use strict";
const { readFileSync } = require("fs");
const text = name => readFileSync(require.resolve(name), "utf8");
exports.words = ["oak", "birch", "hornbeam"];
exports.longest = new Function("words", "return words.reduce((a, b) => (b.length > a.length ? b : a));");
exports.doubled = new Function("n", text("./double.txt"));
