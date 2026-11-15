import { jest, test } from "bun:test";
import { send } from "./barrel.ts";

test("is the first to load it", () => {
  console.log("a", send());
  jest.mock("./barrel.ts", () => ({ send: () => "mocked" }));
  console.log("a", send());
});
