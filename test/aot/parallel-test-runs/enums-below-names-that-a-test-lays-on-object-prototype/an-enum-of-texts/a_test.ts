import { test } from "bun:test";
import { taken, takeAway } from "./lays.ts";
import { State } from "./states.ts";
function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return State.Ready; }
test("a member of an enum is read off its object", () => {
  const found = [read(), State.Done, Object.hasOwn(State, "Ready")];
  takeAway();
  console.log(found.join(), taken.join());
});
