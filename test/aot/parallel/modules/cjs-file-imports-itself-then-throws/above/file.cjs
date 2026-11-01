say("above: the file runs");
exports.value = 1;
require("./below.cjs");
throw new Error("the file above throws");
