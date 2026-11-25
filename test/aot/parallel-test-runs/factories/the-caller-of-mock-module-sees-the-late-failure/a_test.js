import { vi, mock, test } from "bun:test";
import { seen } from "./user.js";
vi.mock("./dep.js", () => ({ flag: "four", fn() {} }));
test("a", async () => {
  console.log("1", seen(), (await import("./dep.js")).flag);
  console.log("2", await mock.module("./dep.js", async () => { await 0; throw new Error("failed"); }).then(() => "resolved", e => "rejected " + e.message));
  console.log("3", seen(), (await import("./dep.js")).flag);
  console.log("4", await mock.module("./dep.js", async () => { await 0; return { flag: "five", fn() {} }; }).then(() => "resolved", e => "rejected " + e.message));
  console.log("5", seen(), (await import("./dep.js")).flag);
});
