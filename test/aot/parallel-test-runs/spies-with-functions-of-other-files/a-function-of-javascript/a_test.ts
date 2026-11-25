// The function of a spy lies in JavaScript with types beside it.
import { expect, spyOn, test } from "bun:test";
import { giveSeven } from "./seven";
test("a seven for each draw", () => {
  const spy = spyOn(Math, "random").mockImplementation(giveSeven);
  console.log("SEEN", Math.random(), Math.random());
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockRestore();
  console.log("SEEN", Math.random() < 1);
});
