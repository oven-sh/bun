import { test, jest } from "bun:test";
import { timersAreFaked, actsAsUnderTheRunner } from "crate";
test("questions", () => {
  console.log(timersAreFaked(), actsAsUnderTheRunner);
  jest.useFakeTimers();
  console.log(timersAreFaked(), actsAsUnderTheRunner);
  jest.useRealTimers();
});
