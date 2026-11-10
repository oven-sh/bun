import { test, vi, jest } from "bun:test";
const path = "./other";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    const real = await vi.importActual(
      './other'
    );
    return { value: "mock" + real.extra };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
