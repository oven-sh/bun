import { test, vi } from "bun:test";
import { send } from "./barrel.ts";

vi.mock("./barrel.ts", () => ({ send: () => "mocked" }));

test("sees the mock", () => {
  console.log("b", send());
});
