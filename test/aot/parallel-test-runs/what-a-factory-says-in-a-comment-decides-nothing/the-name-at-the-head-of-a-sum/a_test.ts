import { test, vi, jest } from "bun:test";
const which = () => "other";
test("whether the mocked file runs", async () => {
  vi.doMock("./own", async () => {
    await vi.importActual("./" + which());
    return { value: "mock" };
  });
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
