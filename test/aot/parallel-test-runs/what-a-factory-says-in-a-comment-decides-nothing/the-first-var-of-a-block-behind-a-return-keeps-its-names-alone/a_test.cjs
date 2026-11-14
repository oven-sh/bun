const { test, vi } = require("bun:test");
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" }; if (true) { let x = 1; var { importOriginal: renamed } = {}; }
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
