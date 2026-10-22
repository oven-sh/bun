const a = require("./a.cjs");
const { n } = a;
exports.read = () => a.n + ":" + n;
exports.bumpTwice = () => {
  a.bump();
  a.bump();
};
