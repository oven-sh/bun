import { test, vi } from "bun:test";
import * as barrel from "./barrel.ts";
import { limit, send } from "./barrel.ts";

vi.mock("./barrel.ts", () => ({ send: () => "mocked" }));

test("sees the mock", async () => {
  console.log("b", send(), barrel.send(), limit, Object.keys(barrel).join());
  const loaded = await import("./barrel.ts");
  console.log("b", loaded.send(), require("./client.cjs").send());
});
