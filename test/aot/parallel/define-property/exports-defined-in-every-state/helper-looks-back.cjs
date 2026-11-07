const half = require("./seen-half-done.cjs");
exports.sawKeys = Reflect.ownKeys(half).join() + "|" + half.__esModule + "|" + half.late;
