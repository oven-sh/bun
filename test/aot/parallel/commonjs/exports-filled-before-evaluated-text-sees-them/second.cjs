const first = require("./first.cjs");
exports.seen = Object.keys(first).join();
freeze(first);
