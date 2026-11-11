import { test, vi } from "bun:test";
const M = "./module.mjs";
const within = (promise, name) => Promise.race([Promise.resolve(promise).then(all => name + " " + (typeof all.seen === "function" ? all.seen() : Object.keys(all).join()), error => name + " threw " + error.message.slice(0, 40)), new Promise(done => setTimeout(done, 1500, name + " HUNG"))]);
const ask = name => { try { return name + " " + Object.keys(require(M)).join(); } catch (error) { return name + " threw " + error.message.slice(0, 40); } };
test("t", async () => {
  let calls = 0;
  vi.doMock(M, original => { calls++; throw new Error("factory " + calls); });
  const second = import(M);
  console.log("SAID " + (await within(second, "second")) + " | " + calls + " " + globalThis.ran);
  console.log("SAID " + (await within(import(M), "again")) + " " + calls + " " + globalThis.ran);
}, 9000);
