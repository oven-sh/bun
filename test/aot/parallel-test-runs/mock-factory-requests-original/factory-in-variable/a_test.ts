import { test, vi, jest, mock } from "bun:test";
test("whether the mocked file runs", async () => {
  const factory = async () => {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    return { ...(await vi.importActual("./own")), value: "mock" };
  };
  vi.doMock("./own", factory);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
