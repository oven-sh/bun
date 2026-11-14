import { vi, mock, jest, test } from "bun:test";
import { user as own } from "./user.js";
const val = v => typeof v === "function" ? "fn" : String(v), say = (...w) => console.log("SAID", ...w), tried = async read => { try { return String(await read()); } catch (e) { return "threw " + e.name; } };
test("a", async () => {
  
  vi.doMock("./dep.cjs", { spy: true });
  say("use", await tried(async () => (await import("./late.js")).late()));
  say("use", await tried(async () => (await import("./late.js")).late()));
  vi.doUnmock("./dep.cjs");
  say("use", await tried(async () => (await import("./late.js")).late()));
  say("own", await tried(() => own()));
});
