globalThis.leaked = function () { try { return m.name; } catch (e) { return e.constructor.name; } };
var caller = require("./callsglobal");
var m = require("./lib");
exports.got = caller.got;
