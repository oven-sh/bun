import { vi, mock, jest, test } from "bun:test";
import * as own from "./dep.cjs";
const say = (...w) => console.log("SAID", ...w); const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  say("start", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./late.js")).late()), "static", await tried(() => [own.flag, own.plain].join()));
  vi.doMock("./dep.cjs", () => ({ flag: "do", plain: "do" }));
  mock.module("./dep.cjs", () => ({ flag: "module", plain: "module" }));
  say("under", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./late.js")).late()), "static", await tried(() => [own.flag, own.plain].join()));
  
  say("end", "import", await tried(async () => (await import("./dep.cjs")).flag), "require", await tried(() => import.meta.require("./dep.cjs").flag), "late", await tried(async () => (await import("./late.js")).late()), "static", await tried(() => [own.flag, own.plain].join()));
});
