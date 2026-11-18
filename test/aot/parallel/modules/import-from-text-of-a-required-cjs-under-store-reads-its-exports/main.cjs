// import() from text under a store of AsyncLocalStorage asks for a CommonJS file of the executable. The job that makes the namespace reads the exports: a getter and the traps of a Proxy run under the store of the call, as in plain Bun, also where require() has run the file before.
// Entry points: ./accessor.cjs ./fresh.cjs ./proxy.cjs
const { AsyncLocalStorage } = require("node:async_hooks");
const path = require("node:path");
const storage = new AsyncLocalStorage();
globalThis.storage = storage;
globalThis.seen = [];
const take = () => JSON.stringify(seen.splice(0));
const importFromText = new Function("path", "return import(path)");
const at = name => path.join(__dirname, name);

require("./accessor.cjs");
require("./proxy.cjs");
require("./compiled.cjs");
console.log("after the requires:", take());

(async () => {
  await storage.run("A", () => importFromText(at("accessor.cjs")));
  console.log("a getter, required, import() from text under A:", take());

  await storage.run("B", () => import("./compiled.cjs"));
  console.log("a getter, required, compiled import() under B:", take());

  await storage.run("C", () => importFromText(at("fresh.cjs")));
  console.log("a getter, not required, import() from text under C:", take());

  await storage.run("D", () => importFromText(at("proxy.cjs")));
  console.log("a Proxy, required, import() from text under D:", take());
})();
