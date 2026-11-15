import { mock, test, vi } from "bun:test";
vi.mock("./m1.mjs", () => { globalThis.R.push("factory"); return { v: "mock" }; });
test("t", async () => { let it; try { it = typeof (await import("./root.mjs")).r; } catch (e) { it = e.name; } console.log("SAID", it, globalThis.R.splice(0).join()); });
