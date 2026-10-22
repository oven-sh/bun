exports.saw = [require("./a.cjs").early, String(require("./a.cjs").late), typeof require("./a.cjs").call].join(" ");
exports.now = () => [require("./a.cjs").early, require("./a.cjs").late, require("./a.cjs").call()].join(" ");
