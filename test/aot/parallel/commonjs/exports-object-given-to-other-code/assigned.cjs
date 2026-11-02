exports.before = 1;
Object.assign(exports, require("./source.cjs"), { extra: true, before: "overwritten" });
Object.defineProperties(exports, Object.getOwnPropertyDescriptors({ after: "defined before the store", get doubled() { return exports.before + exports.before; } }));
exports.after = 2;
exports.fixed = "stored after the copy";
