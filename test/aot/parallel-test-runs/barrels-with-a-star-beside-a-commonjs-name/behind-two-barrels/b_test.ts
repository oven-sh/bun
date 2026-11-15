import { test, vi } from "bun:test";
import * as barrel from "./barrel.ts";
import { send } from "./index.ts";

vi.mock("./index.ts", () => ({ send: () => "mocked" }));

test("sees the mock", () => {
  console.log("b", send(), barrel.send());
});
