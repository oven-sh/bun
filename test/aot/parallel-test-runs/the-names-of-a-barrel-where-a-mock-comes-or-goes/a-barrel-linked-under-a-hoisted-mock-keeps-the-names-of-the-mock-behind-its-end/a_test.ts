import { test, vi } from "bun:test";
import * as barrel from "./barrel.ts";
vi.mock("./lib.ts", () => ({ kept: "mock kept", fn: () => "mock fn", added: "mock added" }));
test("t", async () => {
  console.log("SAID mocked", Object.keys(barrel).sort().join("+"), "|", barrel.fn(), barrel.kept, String(barrel.dropped), String(barrel.added));
  vi.doUnmock("./lib.ts");
  console.log("SAID ended", Object.keys(barrel).sort().join("+"), "|", barrel.fn(), barrel.kept, String(barrel.dropped), String(barrel.added));
  console.log("SAID later", (await import("./later.ts")).names());
  console.log("SAID behind a later load", Object.keys(barrel).sort().join("+"), "|", barrel.fn(), barrel.kept, String(barrel.dropped), String(barrel.added));
});
