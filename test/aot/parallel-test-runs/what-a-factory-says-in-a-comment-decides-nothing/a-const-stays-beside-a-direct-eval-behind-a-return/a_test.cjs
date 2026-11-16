const { test, vi } = require("bun:test");
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    const word = "importOriginal"; return { value: "mock" }; eval("");
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
