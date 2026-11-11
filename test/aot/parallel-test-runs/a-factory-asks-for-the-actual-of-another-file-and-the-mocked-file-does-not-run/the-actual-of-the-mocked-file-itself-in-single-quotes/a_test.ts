import { test, vi, jest } from "bun:test";
const path = "./own";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    const real = await vi.importActual('./own');
    return { value: "mock" + real.extra };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
