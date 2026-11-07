import { test } from "bun:test";
import * as shared from "./shared.js";
import * as own from "./two.js";
test("below bun:test", () => {
  console.log(shared.seen());
  console.log(own.seen());
});
