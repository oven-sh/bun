import { test } from "bun:test";
import "./lays.js";
const which = made => typeof made.toBe + " " + String(made.mine);
const atLoad = which(expect(1));
test("in the file that imports it", () => {
  console.log(atLoad);
  console.log(which(expect(1)));
});
