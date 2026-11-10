import { test, vi } from "bun:test";
enum Names { Zero, One }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    try { await vi.importActual("./other" + Names.One); } catch {}
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", "enum-member-behind", user.look(), String(globalThis.ran));
});
