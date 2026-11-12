import { test, vi, jest } from "bun:test";
import { Flags } from "./made";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    if (Flags.off) await vi.importActual("./own");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
