let a;
try {
  a = require("./a.cjs");
} catch {
  a = {};
}
exports.saw = a.early + ":" + a.late;
exports.now = () => a.early + ":" + a.late;
