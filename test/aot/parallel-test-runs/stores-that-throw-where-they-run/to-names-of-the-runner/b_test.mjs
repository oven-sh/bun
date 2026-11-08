import { test } from "bun:test";
const say = (label, act) => { let seen = "no throw"; try { act(); } catch (e) { seen = e.name + ": " + e.message; } console.log(label, seen); };
test("stores", () => {
  say("=", () => { expect = 1; });
  say("[]", () => { [vi] = [1]; });
  console.log(typeof expect, typeof vi);
});
