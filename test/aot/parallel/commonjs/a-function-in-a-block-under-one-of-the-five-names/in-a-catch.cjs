exports.a = 1;
try { throw 1; } catch (e) { { function module() {} } { function exports() {} } }
module.exports.seen = [typeof exports, typeof module];
