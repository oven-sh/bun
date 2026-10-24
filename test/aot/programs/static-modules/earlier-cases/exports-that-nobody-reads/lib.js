"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unusedDeclared = exports.unusedExpression = exports.used = exports.unusedTable = void 0;
function onlyForUnused() { return "only for unused"; }
exports.used = function used() { return "used"; };
exports.unusedExpression = function unusedExpression() { return onlyForUnused(); };
function unusedDeclared() { return "unused declared"; }
exports.unusedDeclared = unusedDeclared;
exports.unusedTable = { a: function inUnusedTable() { return 1; } };
exports.withEffect = console.log("an effect stays");
