const log = [];
try { u.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var u = exports;
exports.log = log.join();
