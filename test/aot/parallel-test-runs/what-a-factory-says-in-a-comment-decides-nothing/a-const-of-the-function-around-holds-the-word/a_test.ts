import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  const NOTE = "importOriginal";
  vi.doMock("./own", async () => {
    return { value: "mock", note: NOTE };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
