exports.name = "first";
const second = require("./second.cjs");
let stored = "late";
exports.seenBySecond = () => second.sawOfFirst;
exports.late = () => stored;
exports.again = () => second.look();
