const hub = require("./hub.cjs");
console.log("right sees hub", hub.stage);
exports.now = () => hub.stage;
