import { test, vi, jest, mock } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", () => vi.importActual("./own"));
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
