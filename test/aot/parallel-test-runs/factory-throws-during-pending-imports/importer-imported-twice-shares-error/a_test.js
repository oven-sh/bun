import { test, vi } from "bun:test";
const M = "./module.mjs";
const describe = (promise, name) => Promise.resolve(promise).then(all => name + " " + (typeof all.seen === "function" ? all.seen() : Object.keys(all).join()), error => name + " threw " + error.message.slice(0, 40));
const ask = name => { try { return name + " " + Object.keys(require(M)).join(); } catch (error) { return name + " threw " + error.message.slice(0, 40); } };
test("t", async () => {
  let calls = 0;
  const first = import("./importer.mjs");
  vi.doMock(M, original => { calls++; throw new Error("factory " + calls); });
  const second = import("./importer.mjs");
  console.log("SAID " + (await describe(first, "first")) + " | " + (await describe(second, "second")) + " | " + calls + " " + globalThis.ran);
  console.log("SAID " + (await describe(import(M), "again")) + " " + calls + " " + globalThis.ran);
}, 9000);
