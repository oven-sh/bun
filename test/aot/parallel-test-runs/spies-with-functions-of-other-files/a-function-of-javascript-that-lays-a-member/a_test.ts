// The function of a spy lies in JavaScript with types beside it and lays a member on what it is called on.
import { expect, spyOn, test } from "bun:test";
import { floors, half } from "./rounds";
import { takeOver } from "./taker";
test("a spy on one member of Math, whose function lays another", () => {
  const spy = spyOn(Math, "random").mockImplementation(takeOver);
  console.log("SEEN", floors(1.5), half());
  Math.random();
  console.log("SEEN", floors(1.5), half());
  expect(spy).toHaveBeenCalledTimes(1);
});
