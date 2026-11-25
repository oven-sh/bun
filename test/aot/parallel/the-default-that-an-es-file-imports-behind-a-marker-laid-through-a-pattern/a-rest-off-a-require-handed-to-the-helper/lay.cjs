function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const { ...rest } = _interopRequireDefault(require("./part.cjs"));
const whole = rest.default;
whole.default = 5;
whole.__esModule = true;
