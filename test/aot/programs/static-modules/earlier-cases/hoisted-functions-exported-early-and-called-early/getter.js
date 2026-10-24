var o = { get early() { try { return m.name; } catch (e) { return e.constructor.name; } } };
exports.before = o.early;
var m = require("./lib");
