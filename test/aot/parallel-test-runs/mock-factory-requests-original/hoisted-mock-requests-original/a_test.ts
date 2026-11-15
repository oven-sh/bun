import { test, vi, jest } from "bun:test";
vi.mock("./own", async () => {
  globalThis.ran = (globalThis.ran ?? "") + "factory,";
  return { ...(await vi.importActual("./own")), value: "mock" };
});
import { look } from "./user";
test("whether the mocked file runs", () => {
  console.log("SAID", look(), String(globalThis.ran));
});
