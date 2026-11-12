import { test, mock } from "bun:test";
mock.module("./m", () => ({ v: "mocked" }));
test("a", async () => { console.log("a", (await import("./user")).seen()); });
