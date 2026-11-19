// plain.cjs says nothing of CommonJS. real.cjs, which runs amid the statements, holds a require under a name of which the build knows nothing: that brings no other file amid the statements.
import { test } from "bun:test";
import { load } from "./real.cjs";
import "./middle.mjs";
test("the order and the mode", () => {
  console.log(typeof require("./middle.mjs"), typeof load);
});
