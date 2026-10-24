const a = require("./a.js");
exports.name = "b";
exports.sawEarly = a.early; exports.sawLate = a.late;
try { exports.called = a.useB(); } catch (e) { exports.called = e.constructor.name; }
try { exports.calledConst = a.useConst(); } catch (e) { exports.calledConst = e.constructor.name; }
exports.lateNow = function () { return a.late; };
