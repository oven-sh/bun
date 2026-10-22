const f = require("./cyc_f");
try { exports.early = f(); } catch (e) { exports.early = e.constructor.name; }
exports.late = function () { try { return f(); } catch (e) { return e.constructor.name; } };
