// one file wraps two things by the helper that Babel writes for default imports: what lies under `default` of the one does not meet what lies under `default` of the other
// STATISTIC: ImageFunctionsEmitted <= 10
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }
var mathModule = { __esModule: true, default: { add: function (a, b) { return a + b; } }, twice: function (x) { return x * 2; } };
var plainModule = function (x) { return x + 1; };
var _math = _interopRequireDefault(mathModule), _plain = _interopRequireDefault(plainModule);
function run(count) { var total = 0; for (var i = 0; i < count; i++) total += (0, _math.default.add)(i & 7, 1) + (0, _plain.default)(i & 3) + (0, mathModule.twice)(2); return total; }
console.log(run(50));
