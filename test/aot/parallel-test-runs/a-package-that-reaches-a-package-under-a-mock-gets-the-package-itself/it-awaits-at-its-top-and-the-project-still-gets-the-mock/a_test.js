import { test, vi } from "bun:test";
import { seen } from "lamp";
import own from "./own.cjs";
vi.mock("wick", () => ({ width: () => "mocked" }));
const say = get => { try { return String(get()); } catch (error) { return "threw " + error.name; } };
test("a", async () => {
  console.log(say(seen), "|", say(own.seen), "|", say(seen), "|", say(own.seen), "|", globalThis.bodies);
  for (let turn = 0; turn < 12; turn++) await 0;
  console.log(say(seen), "|", say(own.seen), "|", globalThis.bodies);
});
