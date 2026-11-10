import { test, vi, jest } from "bun:test";
const via_importActual = (path: string) => vi.importActual(path);
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    await via_importActual("./other");
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
