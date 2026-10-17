const log = [];
try { c.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
const c = exports;
exports.log = log.join();
