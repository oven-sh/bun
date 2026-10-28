const { a, f } = require("./m.cjs");
const m = require("./m.cjs");
exports.see = () => [a, f(), m.a, m.f()].join();
