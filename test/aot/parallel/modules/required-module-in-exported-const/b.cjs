const a = require("./a.ts");
module.exports = [a.held.constant, a.loose.twice(4), a.renamed.counter, a.default.constant, a.held === a.loose, typeof a.give().twice].join(" ");
