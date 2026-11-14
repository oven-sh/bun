const { value, other } = require("./dep.cjs");
exports.read = () => value() + " " + other;
