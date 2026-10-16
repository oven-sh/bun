exports.stored = 1;
exports.changed = undefined;
if (typeof exports.stored === "string") exports.notTaken = 3;
setTimeout(() => {
  exports.changed = "changed";
  exports.later = "later";
}, 0);
exports.default = "the default of the CommonJS module";
