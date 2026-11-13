import { mock, test, vi } from "bun:test";
test("t", async () => { mock.module("./m1.mjs", () => { globalThis.R.push("factory"); return { v: "mock" }; }); let it; try { it = typeof (await import("./root.mjs")).r; } catch (e) { it = e.name; } console.log("SAID", it, globalThis.R.splice(0).join()); });
