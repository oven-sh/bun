exports.ask = () => require("./lib.cjs").n;
exports.children = () => module.children.map(child => child.exports.n).join();
