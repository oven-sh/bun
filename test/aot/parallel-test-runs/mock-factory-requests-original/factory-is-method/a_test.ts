import { test, vi, jest, mock } from "bun:test";
const holder = {
  async factory() {
    globalThis.ran = (globalThis.ran ?? "") + "factory,";
    return { ...(await vi.importActual("./own")), value: "mock" };
  },
};
test("whether the mocked file runs", async () => {
  vi.doMock("./own", holder.factory);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
