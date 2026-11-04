const one = require("./lib-cycle-one.cjs");
exports.seen = typeof one.early + " " + typeof one.late;
exports.ask = () => typeof one.late;
