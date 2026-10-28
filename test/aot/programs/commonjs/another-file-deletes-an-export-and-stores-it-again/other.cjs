const m = require("./m.cjs");
exports.see = () => String(m.a) + ("a" in m);
