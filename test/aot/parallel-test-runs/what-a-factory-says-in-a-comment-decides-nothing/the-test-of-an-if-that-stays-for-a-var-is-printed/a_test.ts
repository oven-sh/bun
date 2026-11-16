import { test, vi, jest } from "bun:test";
enum Notes { importOriginal = 1 }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    if (Notes.importOriginal) {} else { var spare; } return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
