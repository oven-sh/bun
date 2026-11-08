import { test } from "bun:test";
import { taken, takeAway } from "./lays.ts";
import { State } from "./states.ts";
test("a member of the second declaration is read off the object", () => {
  const found = [State.Ready, State.Late, Object.hasOwn(State, "Late")];
  takeAway();
  console.log(found.join(), taken.join());
});
