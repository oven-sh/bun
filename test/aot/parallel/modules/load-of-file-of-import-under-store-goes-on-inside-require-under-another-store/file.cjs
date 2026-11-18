see("file");
store.run("R", () => require("./required.mjs"));
see("file behind require()");
exports.name = "file";
