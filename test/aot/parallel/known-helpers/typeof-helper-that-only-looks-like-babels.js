// Functions with the name of the helper and nearly its text.
"use strict";
var first = (function () {
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o + "!"; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  return [_typeof(1), _typeof(null), _typeof("a") === "string"];
})();
var second = (function () {
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" != typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  var fake = { constructor: Symbol };
  return [_typeof(1), _typeof(fake), _typeof(fake) === "object", _typeof(Symbol.prototype)];
})();
var third = (function (Symbol) {
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  var made = new Symbol();
  return [_typeof(1), _typeof(made), _typeof(made) === "object"];
})(function Symbol() {});
console.log([first, second, third].map(function (list) { return list.join(); }).join("\n"));
