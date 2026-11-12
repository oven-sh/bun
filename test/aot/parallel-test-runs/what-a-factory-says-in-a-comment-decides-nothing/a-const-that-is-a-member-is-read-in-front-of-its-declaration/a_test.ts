import { test, vi, jest } from "bun:test";
enum Notes { importOriginal = 1 }
test("whether the mocked file runs", async () => {
  const make = () => ({ value: "mock", kind });
  const kind = Notes.importOriginal;
  vi.doMock("./own", make);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
