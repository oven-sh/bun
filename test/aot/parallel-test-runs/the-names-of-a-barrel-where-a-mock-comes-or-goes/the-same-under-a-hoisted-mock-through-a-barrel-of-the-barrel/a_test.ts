import { test, vi } from "bun:test";
import * as outer from "./outer.ts";
vi.mock("./lib.ts", () => ({ kept: "mock kept", fn: () => "mock fn", added: "mock added" }));
test("t", async () => {
  console.log("SAID mocked", Object.keys(outer).sort().join("+"), "|", outer.fn(), outer.kept, String(outer.dropped), String(outer.added));
  vi.doUnmock("./lib.ts");
  console.log("SAID later", (await import("./later.ts")).names());
  console.log("SAID behind a later load", Object.keys(outer).sort().join("+"), "|", outer.fn(), outer.kept, String(outer.dropped), String(outer.added));
});
