import { test, vi } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" }; enum Kind { importOriginal }
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
