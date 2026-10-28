exports.f = f;
const b = require("./b.cjs");
const K = 10;
exports.result = b.r + "," + f();
function f() { try { return K; } catch (e) { return e.name; } }
