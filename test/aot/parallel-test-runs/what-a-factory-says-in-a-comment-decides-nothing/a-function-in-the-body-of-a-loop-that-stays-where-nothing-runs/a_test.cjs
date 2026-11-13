const { test, vi } = require("bun:test");
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    if (false) { for (var i = 0; spare; ) { function g(importOriginal) {} } } var spare; return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
