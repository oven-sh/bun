(globalThis.log ??= []).push("k");
let n = 0;
exports.x = "real";
exports.bump = () => ++n;
exports.count = () => n;
