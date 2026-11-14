"use strict";
const _a = require("./a.cjs");
function look(read) { try { const value = read(); return typeof value === "function" ? "function " + value.name : String(value); } catch (error) { return error.name + ": " + error.message; } }
exports.peek = function () {
  return [look(() => _a.f), look(() => _a.x), look(() => _a.__esModule)].join(" | ");
};
