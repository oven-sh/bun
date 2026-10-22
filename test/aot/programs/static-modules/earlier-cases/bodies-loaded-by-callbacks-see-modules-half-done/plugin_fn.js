const f = require("./fn");
exports.seen = "fn:" + typeof f + ":" + (function () { try { return f(); } catch (e) { return e.constructor.name; } })();
exports.later = function () { try { return f(); } catch (e) { return e.constructor.name; } };
