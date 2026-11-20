import { test, vi, jest } from "bun:test";
enum Notes { importOriginal = 1 }
test("whether the mocked file runs", async () => {
  const off = Notes.importOriginal;
  vi.doMock("./own", () => {
    if (off) return { value: "mock" };
    return { value: "no" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
