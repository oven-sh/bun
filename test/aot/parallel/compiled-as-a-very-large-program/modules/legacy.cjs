console.log("legacy runs");
exports.named = n => n * 3;
exports.later = undefined;
exports.read = () => exports.later + " " + require("./settings.json").host;
