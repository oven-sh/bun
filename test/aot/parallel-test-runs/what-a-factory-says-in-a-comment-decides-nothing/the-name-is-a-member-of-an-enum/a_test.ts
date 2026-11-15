import { test, vi, jest } from "bun:test";
enum Names { Other = "./other" }
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    await vi.importActual(Names.Other);
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
