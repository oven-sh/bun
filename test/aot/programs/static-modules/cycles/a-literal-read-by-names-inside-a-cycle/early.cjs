const literal = require("./literal.cjs");
exports.oneThen = literal.one;
exports.twoThen = literal.two;
exports.oneLater = () => literal.one;
exports.twoLater = () => literal.two;
