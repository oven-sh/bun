import { test, vi, jest, mock } from "bun:test";
test("whether the mocked file runs", async () => {
  (globalThis as any).vi = vi;
  vi.doMock("./own", new Function('globalThis.ran = (globalThis.ran ?? "") + "factory,"; return vi.importActual("./own")') as any);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
