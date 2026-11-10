import { jest, test } from "bun:test";
import * as valve from "./valve.mjs";
test("the two", () => {
  jest.mock("./valve.mjs");
  const first = valve.open;
  first();
  jest.mock("./valve.mjs");
  const second = valve.open;
  second();
  console.log("SAID", first === second, first.mock.calls.length, second.mock.calls.length, valve.size);
});
