import { test, vi, jest } from "bun:test";
enum Notes { importOriginal = 1 }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" }; if (Notes.importOriginal) { var spare; }
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
