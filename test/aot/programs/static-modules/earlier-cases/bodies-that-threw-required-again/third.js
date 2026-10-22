const always = require("./always");
exports.always = (function () { try { return typeof always + ":" + always(); } catch (e) { return typeof always + ":" + e.constructor.name; } })();
