const m = require("./shared");
function use(o) { o.a = 10; o.added = "added"; }
exports.touch = function () { use(m); };
