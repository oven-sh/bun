import { test, vi, jest, mock } from "bun:test";
vi.mock("./r1.mjs", () => ({ r1Name: () => "Mr1", r1Value: () => "Vr1", r1Hit: () => 7 }));
import { w } from "./w.mjs";
import { middle } from "./middle.mjs";
test("b", async () => { console.log("SAID b", w(), middle()); const t1 = await import("./r1.mjs"); console.log("SAID b2", Object.keys(t1).sort().join(), t1.r1Hit()); });
