import { test, spyOn } from "bun:test";
import { twice, width } from "./fixed-door.cjs";
import * as door from "./fixed-door.cjs";
test("a spy on the file behind the door", () => {
  console.log(twice(width), door.twice(door.width));
  const spy = spyOn(require("./fixed.cjs"), "twice").mockImplementation(() => "spy");
  console.log(twice(width), door.twice(door.width), require("./fixed-door.cjs").twice(1), spy.mock.calls.length);
});
