// The factory requests the original only in the dead else branch of `if (true)`.
import { test, vi, jest, mock } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    if (true) void 0; else if (globalThis.never) await vi.importActual("./own"); else await vi.importActual("./own");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
