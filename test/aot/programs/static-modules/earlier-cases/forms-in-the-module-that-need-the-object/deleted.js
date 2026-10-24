exports.a = 1; exports.b = 2; delete exports.a;
exports.has = function () { return "a" in exports; };
