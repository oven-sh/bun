import { test } from "bun:test";
import "./lays.js";
import { atLoad, made } from "./reads.js";
const which = made => typeof made.toBe + " " + String(made.mine);
test("which expect", () => {
  console.log(which(atLoad));
  console.log(which(made()));
});
