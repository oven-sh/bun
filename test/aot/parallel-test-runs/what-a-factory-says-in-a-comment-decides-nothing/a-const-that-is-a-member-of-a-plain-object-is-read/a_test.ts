const tags = { importOriginal: 1 };
const kind = tags.importOriginal;
import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock", kind };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
