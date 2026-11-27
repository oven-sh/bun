import { test, vi, jest } from "bun:test";
enum Flags { off = 0 }
namespace Flags { export const more = 1; }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    if (Flags.off) await vi.importActual("./own");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
