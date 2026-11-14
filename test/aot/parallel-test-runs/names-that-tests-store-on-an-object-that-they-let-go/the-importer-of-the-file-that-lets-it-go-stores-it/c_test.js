import { test } from "bun:test";
import { places } from "./places.js";
test("c", () => {
  let thrown = "nothing";
  try { for (const place of places) place.__mark = 1; } catch (e) { thrown = e.name; }
  console.log("SEEN " + thrown + " " + String(({}).__mark));
  try { for (const place of places) delete place.__mark; } catch {}
});
