import { test } from "bun:test";
import { taken, takeAway } from "./lays.ts";
import { read } from "./reader.ts";
test("a member of an enum is read off its object", () => {
  const found = [read()];
  takeAway();
  console.log(found.join(), taken.join());
});
