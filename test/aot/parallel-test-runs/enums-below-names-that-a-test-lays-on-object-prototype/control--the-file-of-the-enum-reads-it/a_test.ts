import { test } from "bun:test";
import { taken, takeAway } from "./lays.ts";
import { read } from "./states.ts";
test("the transpiler writes the value where the file of the enum reads it", () => {
  const found = [read()];
  takeAway();
  console.log(found.join(), taken.join());
});
