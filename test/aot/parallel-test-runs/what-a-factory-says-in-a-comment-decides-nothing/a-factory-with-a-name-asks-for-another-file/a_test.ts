import { test, vi, jest } from "bun:test";
const made = async () => {
  await vi.importActual("./other");
  return { value: "mock" };
};
test("whether the mocked file runs", async () => {
  vi.doMock("./own", made);
  const user = await import("./user");
  console.log("SAID", user.look(), String(globalThis.ran));
});
