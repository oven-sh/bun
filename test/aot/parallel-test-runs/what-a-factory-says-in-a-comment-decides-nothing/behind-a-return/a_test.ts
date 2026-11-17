import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    return { value: "mock" };
    await vi.importActual("./own");
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
