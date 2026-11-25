import { test } from "bun:test";
const { who } = await import("made-up-pack");
test("next", () => {
  console.log("SAID next", who);
});
