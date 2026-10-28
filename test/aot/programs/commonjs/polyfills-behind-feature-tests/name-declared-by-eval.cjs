module.exports = function evaluated(text) { eval(text); return typeof Symbol === "function" ? "built in" : require("./shadowed-polyfill.cjs"); };
