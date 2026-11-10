"use strict";
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }
var mathModule = { __esModule: true, default: { add: function (a, b) { return a + b; } }, twice: function (x) { return x * 2; } };
var plainModule = function (x) { return x + 1; };
plainModule.default = function (x) { return x - 100; };
var marked = function (x) { return x * 10; };
marked.__esModule = true; marked.default = function (x) { return x * 1000; };
var _math = _interopRequireDefault(mathModule), _plain = _interopRequireDefault(plainModule), _marked = _interopRequireDefault(marked), _none = _interopRequireDefault(undefined), _text = _interopRequireDefault("text");
function run(count) { var total = 0; for (var i = 0; i < count; i++) total += (0, _math.default.add)(i & 7, 1) + (0, _plain.default)(i & 3) + (0, _marked.default)(i & 1) + (0, mathModule.twice)(2); return total; }
var out = [run(1000), typeof _none.default, _text.default];
_plain.default = function (x) { return x + 2; }; out.push(run(10));
delete _plain.default; try { out.push(run(1)); } catch (error) { out.push(error.constructor.name); }
Object.defineProperty(_plain, "default", { get: function () { return function (x) { return -x; }; }, configurable: true }); out.push(run(10));
Object.setPrototypeOf(_math, { extra: 1 }); out.push(run(10));
console.log(out.join(" | "));
