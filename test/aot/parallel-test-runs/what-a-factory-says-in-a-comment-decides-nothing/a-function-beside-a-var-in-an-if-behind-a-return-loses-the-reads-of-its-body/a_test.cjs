const { test, vi } = require("bun:test");
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" }; if (false) { var spare; function g() { String("importOriginal"); } }
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
