// A property descriptor of require.cache holds what the key reads as: for a built-in module that require() has put there, and for an entry that the
// program stores or defines. Asking whether a key is there makes no entry.
const names = ["bun:jsc", "bun:sqlite", "ws"];
const own = key => names.includes(key) || key.endsWith("the/program.js");
const describe = name => {
  const listed = [name in require.cache, Object.hasOwn(require.cache, name), Object.keys(require.cache).includes(name)];
  const descriptor = Object.getOwnPropertyDescriptor(require.cache, name);
  if (!descriptor) return listed.join(" ") + " no descriptor";
  const { value, ...attributes } = descriptor;
  return [...listed, value === require.cache[name], typeof value, JSON.stringify(attributes)].join(" ");
};

function loadSqlite() {
  return require("bun:sqlite");
}

console.log("at first:", describe("bun:sqlite"));
const sqlite = loadSqlite();
require("ws");
for (const name of names) console.log(name + ":", describe(name));
const held = Object.getOwnPropertyDescriptor(require.cache, "bun:sqlite").value;
console.log("the entry:", held.id, held.exports === sqlite, held === require.cache["bun:sqlite"]);
held.exports = { fake: "stored" };
console.log("a store into the entry that the descriptor holds:", loadSqlite().fake);
held.exports = sqlite;

require.cache["/stored/by/the/program.js"] = { id: "stored", exports: {} };
console.log("stored:", describe("/stored/by/the/program.js"));
const defined = { id: "defined", exports: {} };
Object.defineProperty(require.cache, "/defined/by/the/program.js", { value: defined, writable: true, enumerable: true, configurable: true });
console.log("defined:", describe("/defined/by/the/program.js"), require.cache["/defined/by/the/program.js"] === defined);
console.log("copied:", Object.keys(Object.getOwnPropertyDescriptors(require.cache)).filter(own).sort().join());
console.log("deleted:", delete require.cache["bun:sqlite"], describe("bun:sqlite"));
console.log("without a prototype:", Object.getPrototypeOf(require.cache), typeof require.cache.hasOwnProperty);
