import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    globalThis.note = 1;
    const name = "./other";
    await vi.importActual(name);
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
