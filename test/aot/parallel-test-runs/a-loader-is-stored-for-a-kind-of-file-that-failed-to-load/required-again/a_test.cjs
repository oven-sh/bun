const { test } = require("bun:test");
const Module = require("node:module");
const fs = require("node:fs");
const ask = () => { try { return JSON.stringify(require("./table.rows")); } catch (error) { return "throws"; } };
test("a", () => {
  console.log("before", ask());
  require.extensions[".rows"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8").trim().split(" "); };
  console.log("behind", ask());
  delete require.extensions[".rows"];
  Module._extensions[".rows"] = (module, file) => { module.exports = "again"; };
  console.log("again", ask());
});
