import { test, mock } from "bun:test";
mock.module("./m.mjs", () => ({ v: "mocked", f: () => "mocked f" }));
test("a", async () => { console.log("a", (await import("./user.mjs")).seen()); });
