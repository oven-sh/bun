exports.early = 1;
exports.other = 2;
makeAccessor(exports);
exports.late = 4;
exports.early = exports.late;
