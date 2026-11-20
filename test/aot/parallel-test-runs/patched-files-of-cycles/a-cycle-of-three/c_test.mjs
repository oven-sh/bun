import { test, vi } from "bun:test";
import { middle } from "./middle.mjs";
import { w } from "./w.mjs";
test("c", async () => { console.log("SAID c", w(), middle()); const t1 = await import("./r1.mjs"); console.log("SAID c2", Object.keys(t1).sort().join(), t1.r1Hit()); });
