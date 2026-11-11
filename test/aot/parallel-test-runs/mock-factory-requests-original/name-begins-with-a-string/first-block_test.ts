import { test, vi } from "bun:test";
enum Names { Other = "./other" }
enum Names { More = "./more" }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual(Names.Other); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "first-block", user.look(), String(globalThis.ran));
});
