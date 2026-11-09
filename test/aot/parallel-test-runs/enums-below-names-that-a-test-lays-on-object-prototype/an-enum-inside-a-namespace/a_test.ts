import { test } from "bun:test";
import { taken, takeAway } from "./lays.ts";
import { Machine } from "./states.ts";
test("a member of an enum inside a namespace is read off its object", () => {
  const found = [Machine.State.Ready, Machine.State.Done, Object.hasOwn(Machine.State, "Ready")];
  takeAway();
  console.log(found.join(), taken.join());
});
