// The helper puts another function in its own place at its first call. A program that reads the name sees that.
"use strict";
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var before = _typeof;
var lines = [before.name + " " + before.length, String(before === _typeof)];
lines.push(_typeof(1), String(before === _typeof), _typeof.name + "|" + _typeof.length);
lines.push(before("a"), [1, "a", null].map(_typeof).join());
console.log(lines.join("\n"));
