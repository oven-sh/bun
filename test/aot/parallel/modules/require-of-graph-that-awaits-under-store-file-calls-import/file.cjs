see("file");
store.run("import", () => import("./other.mjs")).then(() => see("behind the import()"));
see("end of file");
module.exports = {};
