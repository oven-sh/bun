import { vi, mock, test } from "bun:test";
import * as top from "./user-top.js";
let booms = 0; const say = (...words) => console.log("|", globalThis.moment, ...words);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\/\S*\//g, "").slice(0, 40); } };
test("it", async () => {
  globalThis.moment = "start";
  say("values:", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./user-late.js")).values()), "top", await tried(async () => top.values()));
  globalThis.moment = "in 0 throws"; try { vi.doMock("./dep.cjs", () => { throw new Error("boom " + ++booms); }); } catch (e) { say("threw " + e.message); }
  globalThis.moment = "behind 0 throws";
  say("values:", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./user-late.js")).values()), "top", await tried(async () => top.values()));
  globalThis.moment = "in 1 module"; try { mock.module("./dep.cjs", () => ({ flag: "module", plain: "module" })); } catch (e) { say("threw " + e.message); }
  globalThis.moment = "behind 1 module";
  say("values:", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./user-late.js")).values()), "top", await tried(async () => top.values()));
  globalThis.moment = "in 2 unmock"; try { vi.doUnmock("./dep.cjs"); } catch (e) { say("threw " + e.message); }
  globalThis.moment = "behind 2 unmock";
  say("values:", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./user-late.js")).values()), "top", await tried(async () => top.values()));
});
