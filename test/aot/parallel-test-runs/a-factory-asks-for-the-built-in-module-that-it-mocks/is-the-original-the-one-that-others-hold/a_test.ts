import { test, mock } from "bun:test";
import { holds } from "./holder";
let given: any;
mock.module("node:path", async () => { given = await import("node:path"); return { ...given, basename: () => "mock name" }; });
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), given.join === holds.join, given.basename === holds.basename, path.join === holds.join, given.default === holds.default); });
