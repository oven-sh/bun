import { test } from "bun:test";
import { load } from "./helper.mjs";
test("b", async () => { const { user } = await load(); console.log("SAID b", user()); const t = await import("./top.mjs"); console.log("SAID b2", t.top(), t.topName, Object.keys(t).sort().join()); });
