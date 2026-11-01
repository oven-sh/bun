// require() starts a CommonJS file, and the file requires an ES module that imports it back. That link copies the exports, which runs the getters once. No import started the file, so nothing copies them again when it returns.
require("./file.cjs");
console.log("main ends");
