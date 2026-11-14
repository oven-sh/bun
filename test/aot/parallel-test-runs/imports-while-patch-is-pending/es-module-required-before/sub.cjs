const { value } = require("./dep.mjs");
exports.read = () => "sub " + value();
