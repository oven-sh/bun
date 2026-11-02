// require() looks in require.cache for one of Bun's own modules under its one name, and answers with what the entry exports.
// An import answers with the module, and require("bun") is read as Bun.
const held = require("bun:sqlite");
const ask = () => require("bun:sqlite").fake + " " + typeof require("bun:sqlite").Database;
async function main() {
  console.log("before", ask());
  const entry = { exports: { fake: "sqlite" } };
  require.cache["bun:sqlite"] = entry;
  console.log("stored", ask(), module.require("bun:sqlite") === entry.exports, typeof held.Database);
  console.log("listed", "bun:sqlite" in require.cache, Object.keys(require.cache).includes("bun:sqlite"), require.cache["bun:sqlite"] === entry);
  console.log("import", typeof (await import("bun:sqlite")).Database);
  const name = "bun:sqlite";
  console.log("names", require(name).fake, require(Date.now() > 0 ? "bun:sqlite" : "ws").fake, require(["bun:sqlite"][0]).fake);
  console.log("made", require("node:module").createRequire(__filename)("bun:sqlite").fake);
  entry.exports = { fake: "other" };
  console.log("other exports", ask());
  require.cache["bun:sqlite"] = undefined;
  console.log("undefined", ask());
  require.cache["bun:sqlite"] = entry;
  delete require.cache["bun:sqlite"];
  console.log("deleted", ask(), typeof require("bun:sqlite").Database === typeof held.Database);

  require.cache.ws = { exports: { fake: "a fake ws" } };
  require.cache[require.resolve("undici")] = { exports: { fake: "a fake undici" } };
  require.cache["bun:jsc"] = { exports: { fake: "a fake bun:jsc" } };
  console.log("ws", require("ws").fake, typeof require("ws").WebSocket);
  console.log("undici", require("undici").fake, typeof require("undici").fetch);
  console.log("bun:jsc", require("bun:jsc").fake, typeof require("bun:jsc").heapSize);
  delete require.cache.ws;
  delete require.cache.undici;
  delete require.cache["bun:jsc"];
  console.log("again", typeof require("ws").WebSocket, typeof require("undici").fetch, typeof require("bun:jsc").heapSize);

  require.cache.bun = { exports: { fake: "bun" } };
  console.log("bun", require("bun").fake, typeof require("bun").file);
}
main();
