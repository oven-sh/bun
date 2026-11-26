console.log("helper");
delete require.cache[require.resolve("./p.cjs")];
delete require.cache[require.resolve("./a.mjs")];
exports.h = 1;
