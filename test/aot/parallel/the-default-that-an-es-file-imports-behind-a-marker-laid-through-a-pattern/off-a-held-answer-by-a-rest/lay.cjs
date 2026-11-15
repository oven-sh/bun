function N(e) { return e && e.__esModule ? e : { default: e }; }
const answer = N(require("./part.cjs"));
const { ...rest } = answer;
const whole = rest.default;
whole.default = 5;
whole.__esModule = true;
