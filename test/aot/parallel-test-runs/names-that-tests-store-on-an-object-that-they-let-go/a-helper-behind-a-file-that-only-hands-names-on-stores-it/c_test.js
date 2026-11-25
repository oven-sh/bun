import { test } from "bun:test";
import { put, drop } from "./barrel.js";
test("c", () => {
  let thrown = "nothing";
  try { put(Object.prototype); } catch (e) { thrown = e.name; }
  console.log("SEEN " + thrown + " " + String(({}).__mark));
  try { drop(Object.prototype); } catch {}
});
