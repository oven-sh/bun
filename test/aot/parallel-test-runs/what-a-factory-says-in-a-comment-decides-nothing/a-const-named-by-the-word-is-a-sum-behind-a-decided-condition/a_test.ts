import { test, vi, jest } from "bun:test";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    const importOriginal = true ? "a" + "b" : "c";
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
