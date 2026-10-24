const report = [];
function outcome(run) {
  try {
    const value = run();
    return typeof value === "number" ? String(value) : (JSON.stringify(value) ?? "undefined");
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
exports.report = report;
exports.uses = function (when) {
  const second = require("./second.cjs");
  report.push(when + " n + 1 -> " + outcome(() => second.n + 1));
  report.push(when + " n | 0 -> " + outcome(() => second.n | 0));
  report.push(when + " a.push(1) -> " + outcome(() => (second.a.push(1), second.a.length)));
  report.push(when + " s.charCodeAt(0) -> " + outcome(() => second.s.charCodeAt(0)));
  report.push(when + " f(1) -> " + outcome(() => second.f(1)));
  report.push(when + " o.x + o.y -> " + outcome(() => second.o.x + second.o.y));
  report.push(when + " keys -> " + outcome(() => Object.keys(second)));
};
const second = require("./second.cjs");
exports.uses("after the second module ran,");
report.push("what the first module took at once -> " + outcome(() => Object.keys(second)));
