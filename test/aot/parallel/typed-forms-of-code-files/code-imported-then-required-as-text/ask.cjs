const first = require("./awning.mjs", { type: "text" });
const second = require("./awning.mjs");
exports.first = Object.keys(first).join();
exports.second = Object.keys(second).join();
exports.same = first === second;
