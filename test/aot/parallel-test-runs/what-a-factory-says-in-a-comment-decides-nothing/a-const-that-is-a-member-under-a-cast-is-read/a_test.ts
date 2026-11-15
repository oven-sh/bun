import { test, vi, jest } from "bun:test";
enum Notes { importOriginal = 1 }
test("whether the mocked file runs", async () => {
  const kind = Notes.importOriginal as number;
  vi.doMock("./own", () => ({ value: "mock", kind }));
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
