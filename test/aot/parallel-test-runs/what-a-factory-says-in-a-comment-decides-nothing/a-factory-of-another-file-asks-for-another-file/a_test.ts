import { test, vi, jest } from "bun:test";
import { made } from "./made";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", made);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
