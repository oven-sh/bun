exports.before = (function () { try { return utils.a; } catch (e) { return e.constructor.name; } })();
var utils = exports;
utils.a = "a";
