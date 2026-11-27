import { mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
globalThis.R = [];
const req = createRequire(import.meta.url);
vi.mock("./m1.mjs", () => { globalThis.R.push("factory"); return { v: "mock" }; });
test("t", async () => { let it; try { it = Object.keys(req("./root.mjs")).join(); } catch (e) { it = "threw"; } console.log("SAID", it, R.splice(0).join()); await 0; await 0; let im; try { im = Object.keys(await import("./root.mjs")).join(); } catch (e) { im = e.name; } console.log("SAID", im, R.splice(0).join()); });
