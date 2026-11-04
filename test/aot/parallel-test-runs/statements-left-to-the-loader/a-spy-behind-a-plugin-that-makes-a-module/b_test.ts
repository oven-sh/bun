import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker("./src/between.ts"); console.log("SEEN b"); });
