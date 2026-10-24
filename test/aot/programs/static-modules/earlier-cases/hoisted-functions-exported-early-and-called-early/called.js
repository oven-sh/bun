exports.before = early();
var m = require("./lib");
function early() { try { return m.name; } catch (e) { return e.constructor.name; } }
exports.after = early();
