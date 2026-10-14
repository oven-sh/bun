const log = [];
try { u.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var u = module.exports;
exports.log = log.join();
