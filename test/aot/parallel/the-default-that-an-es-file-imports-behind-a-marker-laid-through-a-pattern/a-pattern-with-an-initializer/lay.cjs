function N(e) { return e && e.__esModule ? e : { default: e }; }
const { default: whole = 1 } = N(require("./part.cjs"));
whole.default = 5;
whole.__esModule = true;
