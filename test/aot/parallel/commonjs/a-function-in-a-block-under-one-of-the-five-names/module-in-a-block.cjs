const before = typeof module;
{ function module() {} }
exports.seen = [before, typeof module, typeof module.exports];
