import { test, vi, jest, mock } from "bun:test";
import { factory } from "./factory.cjs";
test("whether the mocked file runs", async () => {
  jest.doMock("./own", factory);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
