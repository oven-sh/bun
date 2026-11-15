import { test, vi, jest } from "bun:test";
import { Notes } from "./made";
test("whether the mocked file runs", async () => {
  const kind = Notes.importOriginal;
  vi.doMock("./own", () => ({ value: "mock", kind }));
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
