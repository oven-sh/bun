exports.early = 1;
exports.loaded = import("./b.cjs").then(namespace => namespace.default.saw);
exports.late = 2;
