import { test, vi } from "bun:test";
enum Names { Other = "./ot" }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual(Names.Other + "her"); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "enum-member-in-sum", user.look(), String(globalThis.ran));
});
