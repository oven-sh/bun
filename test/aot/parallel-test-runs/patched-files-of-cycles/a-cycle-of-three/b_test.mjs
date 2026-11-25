import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
mock.module("./r2.mjs", async original => ({ ...(await original()), r2Name: () => "Mr2", r2Value: () => "Vr2" }));
const { w } = await import("./w.mjs"); const { middle } = await import("./middle.mjs"); console.log("SAID b", w(), middle()); const t1 = await import("./r1.mjs"); console.log("SAID b2", Object.keys(t1).sort().join(), t1.r1Hit()); });
