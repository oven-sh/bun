import { test } from "bun:test";
import { again } from "./src/asks.js";
test("it answers", () => {
  let said;
  try { said = again(); } catch (e) { said = "threw " + e.name; }
  console.log("SAID", said);
});
