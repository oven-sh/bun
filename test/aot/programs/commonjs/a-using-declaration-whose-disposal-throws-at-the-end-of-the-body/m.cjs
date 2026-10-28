using r = { [Symbol.dispose]() { throw new Error("dispose"); } };
exports.a = 1;
exports.b = require("./x.cjs").v;
