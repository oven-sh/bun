console.log("real");
process.nextTick(() => console.log("tick of real"));
exports.present = 1;
exports.load = () => require("./plain.cjs");
