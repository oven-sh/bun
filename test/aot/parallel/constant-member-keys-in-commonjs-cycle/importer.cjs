"use strict";
const exporter = require("./exporter.cjs");
module.exports = typeof exporter.read;
module.exports = Object.assign(function () {}, { toString: () => "function", again: () => exporter.read({ a: 1 }) + exporter.later({ b: 1 }) });
