import { test, mock } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => { const space = await import("./area.mjs"); const before = String(space.count); const said = typeof space.bump === "function" ? space.bump() + space.bump() : "no function"; console.log("a", before, said, String(space.count)); });
