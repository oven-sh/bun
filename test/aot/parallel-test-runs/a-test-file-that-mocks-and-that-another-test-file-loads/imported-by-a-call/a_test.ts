import { test } from "bun:test";
await import("./b_test");
test("a", () => console.log("a"));
