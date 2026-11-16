import { test, vi, mock } from "bun:test";
import { seen } from "lamp";
import own from "./own.cjs";
vi.mock("wick", () => ({ width: () => "mocked" }));
mock.module("oil", () => { throw new RangeError("oil fails"); });
const say = get => { try { return String(get()); } catch (error) { return "threw " + error.name; } };
test("a", () => {
  console.log(say(seen), "|", say(own.seen), "|", say(seen), "|", say(own.seen), "|", globalThis.bodies);
});
