import { jest, mock, test, vi } from "bun:test";
import { read } from "./user.mjs";
test("a", async () => {
  jest.mock("./dep.mjs", async () => {
    await new Promise(() => {});
    return { a: "mock" };
  });
  console.log("SAID a", read());
});
