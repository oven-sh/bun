import { test } from "bun:test";
const take = it => it;
test("c", () => {
  let thrown = "nothing";
  try { take(globalThis).putFar(Object.prototype); } catch (e) { thrown = e.name; }
  console.log("SEEN " + thrown + " " + String(({}).__far));
  try { take(globalThis).takeFar(Object.prototype); } catch {}
});
