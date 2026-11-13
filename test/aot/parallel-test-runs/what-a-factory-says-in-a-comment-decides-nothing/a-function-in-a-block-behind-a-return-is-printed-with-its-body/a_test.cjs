const { test, vi } = require("bun:test");
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" }; { function g() { importOriginal; } }
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
