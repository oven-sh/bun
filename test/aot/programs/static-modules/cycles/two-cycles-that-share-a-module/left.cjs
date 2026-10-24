const hub = require("./hub.cjs");
console.log("left sees hub", hub.stage);
exports.now = () => hub.stage;
