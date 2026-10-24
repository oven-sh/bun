function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var _a = _interopRequireDefault(require("./a.js"));
exports.seen = typeof _a.default;
exports.later = () => typeof _a.default + " " + typeof _interopRequireDefault(require("./a.js")).default;
