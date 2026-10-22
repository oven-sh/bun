class C { static before = (() => { try { return m.name; } catch (e) { return e.constructor.name; } })(); }
var m = require("./lib");
exports.before = C.before;
