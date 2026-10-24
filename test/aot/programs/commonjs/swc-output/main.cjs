// CommonJS as SWC emits it: `_export(exports, { name: function() { return name; } })` defines a getter for each name. Nobody looks at the objects, so the names are variables. report.cjs hands on a name of a module that it requires behind the definition, and keeps its object.
// STATISTIC: ModulesWithNames = 2
"use strict";
const _shapes = require("./shapes.cjs");
const _report = require("./report.cjs");
const square = new _shapes.Square(3);
console.log((0, _shapes.area)(square), _shapes.UNIT, _shapes.default.name, _shapes.__esModule);
console.log((0, _report.describe)(square), (0, _report.count)());
console.log((0, _report.describe)(new _shapes.Square(4)), (0, _report.count)());
console.log(typeof _shapes.missing, typeof _report.area, _report.unit);
