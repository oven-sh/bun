import { test, vi } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual("./own".concat("")); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "own-method", user.look(), String(globalThis.ran));
});
