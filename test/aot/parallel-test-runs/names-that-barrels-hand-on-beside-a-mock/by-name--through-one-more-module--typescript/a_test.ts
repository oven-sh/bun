import { test, mock } from "bun:test";
mock.module("./m", () => ({ v: "mocked" }));
test("a", async () => { const p = await import("./p"); const named = await import("./named"); console.log("a", String(p.v), named.seen(), Object.keys(p).join()); });
