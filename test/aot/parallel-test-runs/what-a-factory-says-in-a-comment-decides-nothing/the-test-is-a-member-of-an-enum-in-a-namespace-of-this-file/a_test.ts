import { test, vi, jest } from "bun:test";
namespace Racks { export enum Flags { off = 0 } }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    if (Racks.Flags.off) await vi.importActual("./own");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
