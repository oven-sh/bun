exports.load = name => require("./near/" + name);
exports.resolved = require.resolve("../plugins/only-resolved.cjs");
