console.log("helper");
delete require.cache[require.resolve("./p.cjs")];
delete require.cache[require.resolve("./a.cjs")];
require("./p.cjs");
exports.h = 1;
