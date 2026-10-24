const thrown = require("./thrown");
exports.thrown = (function () { try { return typeof thrown + ":" + thrown(); } catch (e) { return typeof thrown + ":" + e.constructor.name; } })();
