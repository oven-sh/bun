exports.early = typeof module;
var module = 1;
exports.late = module;
