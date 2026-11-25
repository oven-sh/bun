import { test, vi } from "bun:test";
const said = load => Promise.resolve(load).then(it => String(it.kept ?? it.default?.kept), error => error.message);
globalThis.calls = 0;
test("t", async () => {
  vi.doMock("./unit.cjs", () => {
    globalThis.calls++;
    const it = require("./unit.cjs");
    return { kept: "mock over " + it.kept };
  });
  const one = await said(import("./unit.cjs"));
  const two = await said(import("./unit.cjs"));
  console.log("SAID", one, "|", two, "| calls", globalThis.calls, "| bodies", globalThis.bodies);
});
globalThis.neverCalled = () => {
  delete require.cache[require.resolve("./unit.cjs")];
};
