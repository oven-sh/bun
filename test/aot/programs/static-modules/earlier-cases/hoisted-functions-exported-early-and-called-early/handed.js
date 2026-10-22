var registry = require("./registry");
registry.register(early);
var m = require("./lib");
function early() { try { return m.name; } catch (e) { return e.constructor.name; } }
exports.got = registry.got;
