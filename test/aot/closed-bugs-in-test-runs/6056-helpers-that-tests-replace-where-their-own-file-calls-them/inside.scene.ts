import { test } from "bun:test";
import { make, named, replaceInside } from "./own.mjs";
test("stored inside", () => {
  console.log("SAID inside before", Object.keys(make()).join(), named());
  replaceInside();
  console.log("SAID inside behind", Object.keys(make()).join(), named());
});
