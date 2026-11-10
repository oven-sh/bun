import { test, vi } from "bun:test";
enum Names { First = "./other", Other = First }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual(Names.Other); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "enum-member-from-member", user.look(), String(globalThis.ran));
});
