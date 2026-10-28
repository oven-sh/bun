require("./peek.cjs").held = exports;
function id() {}
id(exports.a = 1, JSON.parse("{"), exports.b = 2);
exports.c = 3;
