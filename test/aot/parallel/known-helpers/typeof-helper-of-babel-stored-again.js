// The program stores something else under the name of the helper.
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var lines = [_typeof(1), _typeof(null)];
function replace() { _typeof = function (value) { return "replaced " + typeof value; }; }
function ask(value) { return _typeof(value) === "number" ? "a number" : _typeof(value); }
lines.push(ask(1), ask("a"));
replace();
lines.push(ask(1), ask("a"), _typeof(null));
console.log(lines.join("\n"));
