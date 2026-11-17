import { test, vi } from "bun:test";
import { seen } from "lamp";
import own from "./own.cjs";
const say = get => { try { return String(get()); } catch (error) { return "threw " + error.name; } };
test("a", () => {
  globalThis.fails = true;
  console.log(say(own.seen));
  vi.doMock("wick", async () => { globalThis.calls = (globalThis.calls || 0) + 1; await 0; return { width: () => "mocked" }; });
  console.log(say(seen), "|", say(own.seen), "|", say(seen), "|", globalThis.bodies, globalThis.calls);
});
