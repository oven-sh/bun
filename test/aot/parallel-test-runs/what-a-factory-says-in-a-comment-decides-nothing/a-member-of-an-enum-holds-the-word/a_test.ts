import { test, vi, jest } from "bun:test";
enum Notes { First = "importOriginal" }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock", note: Notes.First };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
