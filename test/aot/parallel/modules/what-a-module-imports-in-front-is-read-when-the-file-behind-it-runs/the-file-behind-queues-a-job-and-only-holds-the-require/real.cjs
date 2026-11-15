console.log("real");
queueMicrotask(() => console.log("job of real"));
exports.present = 1;
exports.load = () => require("./plain.cjs");
