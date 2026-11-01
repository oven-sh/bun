const names = ["bun", "bun:jsc", "bun:sqlite", "fs", "node:fs", "undici", "ws"];
const listed = () => Object.keys(require.cache).filter(key => names.includes(key)).join() || "none";
const has = name =>
  [
    name in require.cache,
    typeof require.cache[name],
    Object.getOwnPropertyDescriptor(require.cache, name) !== undefined,
  ].join(" ");

function loadSqlite() {
  return require("bun:sqlite");
}

console.log("at first:", listed(), has("bun:sqlite"));
require("ws");
console.log("ws:", listed(), has("ws"));
const sqlite = loadSqlite();
console.log("bun:sqlite:", listed(), has("bun:sqlite"));
require("node:fs");
require("fs");
require("bun");
console.log("node:fs, fs, bun:", listed(), has("node:fs"), has("fs"), has("bun"));
const computed = ["bun", "jsc"].join(":");
require(computed);
require("undici");
console.log("bun:jsc, undici:", listed());

console.log("deleted:", delete require.cache["bun:sqlite"], listed(), has("bun:sqlite"));
console.log("again:", loadSqlite() === sqlite, listed(), has("bun:sqlite"));

let same = 0;
for (let i = 0; i < 1000; i++) if (loadSqlite() === sqlite) same++;
console.log("a thousand times:", same, listed());

const entry = require.cache["bun:sqlite"];
console.log("entry:", entry.id, entry.filename, entry.loaded, entry.exports === sqlite, entry.children.length);
console.log("entry:", entry === require.cache["bun:sqlite"], Object.keys(entry).join());
for (const key in require.cache) if (names.includes(key)) console.log("for-in:", key);
console.log("spread:", Object.keys({ ...require.cache }).filter(key => names.includes(key)).join());
console.log("Module._cache:", "ws" in require("node:module")._cache);
