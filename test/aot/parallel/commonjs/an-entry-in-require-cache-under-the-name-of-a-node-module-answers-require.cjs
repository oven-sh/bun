// require() looks in require.cache for a Node.js module that is named without `node:`, and answers with what the entry exports.
// require("node:fs"), process.getBuiltinModule("fs") and import("fs") answer with the module.
const held = require("fs");
const ask = () => typeof require("fs").readFileSync;
async function main() {
  console.log("before", ask());
  const entry = { exports: { readFileSync: 1 } };
  require.cache["fs"] = entry;
  console.log("stored", ask(), typeof module.require("fs").readFileSync, require("fs") === entry.exports);
  console.log("the module", typeof require("node:fs").readFileSync, typeof process.getBuiltinModule("fs").readFileSync, typeof held.readFileSync);
  console.log("import", typeof (await import("fs")).readFileSync);
  const name = "fs";
  console.log("names", typeof require(name).readFileSync, typeof require(Date.now() > 0 ? "fs" : "path").readFileSync, typeof require(["fs"][0]).readFileSync);
  console.log("made", typeof require("node:module").createRequire(__filename)("fs").readFileSync);
  entry.exports = { readFileSync: "text" };
  console.log("other exports", ask());
  require.cache["fs"] = undefined;
  console.log("undefined", ask());
  require.cache["fs"] = entry;
  delete require.cache["fs"];
  console.log("deleted", ask(), require("fs") === require("node:fs"), require("fs") === held);

  require.cache[require.resolve("os")] = { exports: { platform: "a fake" } };
  console.log("os", require("os").platform, typeof require("node:os").platform);
  delete require.cache.os;
  console.log("os again", typeof require("os").platform);

  require.cache["fs/promises"] = { get exports() { console.log("exports is read"); return { readFile: 2 }; } };
  console.log("fs/promises", typeof require("fs/promises").readFile, typeof require("node:fs/promises").readFile);
  delete require.cache["fs/promises"];

  require.cache["node:path"] = { exports: { join: 1 } };
  console.log("node:path", typeof require("node:path").join, typeof require("path").join);
  delete require.cache["node:path"];
}
main();
