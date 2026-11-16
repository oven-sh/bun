import { test, vi, jest } from "bun:test";
const importOriginal = vi;
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    await importOriginal.importActual("./other");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
