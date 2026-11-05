import { test, mock } from "bun:test";
mock.module("node:path", async () => ({ ...(await import("node:path")), basename: () => "mock name" }));
test("a", async () => { console.log("a", (await import("./reader")).read("/x/y.txt")); });
