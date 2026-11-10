import { beforeEach, jest, test } from "bun:test";
import * as valve from "./valve.mjs";
import { held, pump } from "./pump.mjs";
// Each laying makes new functions: neither the calls nor the answer that a test set go on into the next test.
const seen = [];
beforeEach(() => {
  jest.mock("./valve.mjs");
});
for (const step of [1, 2, 3]) {
  test("test " + step, () => {
    const before = pump();
    valve.open.mockReturnValue("set in " + step);
    seen.push(valve.open);
    console.log("SAID", step, before, pump(), valve.open.mock.calls.length, held() === valve.open, seen.map(each => each === seen[0]).join());
  });
}
