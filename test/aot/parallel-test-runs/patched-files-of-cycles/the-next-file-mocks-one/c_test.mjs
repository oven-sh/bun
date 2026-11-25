import { test, vi } from "bun:test";
vi.mock("./r1.mjs", async () => { await 0; return { r1Name: () => "Mr1", r1Value: () => "Vr1", r1Hit: () => 7 }; });
import { middle } from "./middle.mjs";
import { w } from "./w.mjs";
test("c", async () => { console.log("SAID c", w(), middle()); const t1 = await import("./r1.mjs"); console.log("SAID c2", Object.keys(t1).sort().join(), t1.r1Hit()); });
