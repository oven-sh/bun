import { test, vi, jest, mock } from "bun:test";
enum Notes { importOriginal = 1 }
const kind = Notes.importOriginal;
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    return { value: kind + 1 };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
