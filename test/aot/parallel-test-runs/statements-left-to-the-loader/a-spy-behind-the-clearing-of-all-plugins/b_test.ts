import { test } from "bun:test";
test("b", () => { if (process.env.NOBODY_SETS_THIS) new Worker(new URL("./src/between.ts", import.meta.url).href); console.log("SEEN b"); });
