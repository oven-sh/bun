import { test, vi } from "bun:test";
test("t", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  const word = (load, name) => Promise.resolve(load).then(it => String(it[name]), error => error.constructor.name + ": " + error.message.slice(0, 40));
  vi.doMock("./m.js", () => { called.resolve(); return answer.promise; });
  const first = word(import("./uses.js"), "seen");
  await called.promise;
  vi.doMock("./m.js", () => { calls++; return { x: "new x" }; });
  const go = () => { try { return require("./m.js"); } catch (error) { return Promise.reject(error); } };
  const second = word(answer.promise.then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(go, go), "x");
  answer.resolve({ x: "old x" });
  const one = await first, two = await second;
  console.log("SAID 16", one, "|", two, "|", await word(import("./m.js"), "x"), calls, globalThis.ran ?? "-");
});
