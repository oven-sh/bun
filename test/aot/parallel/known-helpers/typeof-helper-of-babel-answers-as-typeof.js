// `_typeof(value)` as Babel writes it for `typeof value`: as a value, as a test, in a switch, at the top level, in a function, a method and a field.
"use strict";
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
var values = [1, 1.5, "a", "", {}, null, undefined, function () {}, Symbol.iterator, [], 10n, true, /x/, new Date(0), Object(Symbol.iterator), Object.create(null), class {}, new Proxy({}, {}), new Proxy(function () {}, {}), NaN];
var calls = 0;
function counted(value) { calls++; return value; }
function describe(value) {
  if (_typeof(value) === "object" && value !== null) return "an object";
  if ("function" == _typeof(value)) return "a function";
  if (_typeof(value) !== "undefined" && _typeof(value) != "symbol") return "a " + _typeof(value);
  switch (_typeof(value)) {
    case "symbol": return "a symbol";
    default: return "nothing: " + _typeof(value);
  }
}
var holder = {
  method: function method(value) { return _typeof(counted(value)) === "string" ? value.length : -1; },
};
var Kept = function Kept(value) { this.kind = _typeof(value); this.isNumber = _typeof(value) === "number"; };
class WithField { kind = _typeof(values[8]); static kind = _typeof(values[10]); }
var lines = [];
var atTopLevel = _typeof(values[2]);
for (var round = 0; round < 3; round++) {
  for (var i = 0; i < values.length; i++) {
    var kept = new Kept(values[i]);
    lines.push(i + ": " + _typeof(values[i]) + " | " + describe(values[i]) + " | " + holder.method(values[i]) + " | " + kept.kind + " " + kept.isNumber);
  }
}
function ofUndeclared() { try { return _typeof(neverDeclared); } catch (error) { return error.name; } }
function ofUndeclaredInTest() { try { return _typeof(neverDeclared) === "undefined" ? "no throw" : "other"; } catch (error) { return error.name; } }
function inDeadZone() { try { return _typeof(later); } catch (error) { return error.name; } let later = 1; return later; }
lines.push(atTopLevel, new WithField().kind, WithField.kind, ofUndeclared(), ofUndeclaredInTest(), inDeadZone(), String(calls), _typeof(), _typeof(1, "second"), _typeof(...["spread"]));
console.log(lines.join("\n"));
