import { test, vi } from "bun:test";
import * as valve from "./valve.mjs";
test("the two", () => {
  vi.mock("./valve.mjs", { spy: true });
  const first = valve.open;
  const one = first();
  vi.mock("./valve.mjs", { spy: true });
  const second = valve.open;
  const two = second();
  console.log("SAID", first === second, first.mock.calls.length, second.mock.calls.length, one, two);
});
