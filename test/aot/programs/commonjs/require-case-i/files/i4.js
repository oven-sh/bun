const log = [];
try { m.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var m = require("./io");
exports.log = log.join();
