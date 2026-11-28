import { test } from "bun:test";
import "./root.mjs";
test("b", async () => console.log((await import("./up.mjs")).m));
