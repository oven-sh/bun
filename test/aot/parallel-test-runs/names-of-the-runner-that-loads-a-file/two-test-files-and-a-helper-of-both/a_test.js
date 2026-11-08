import { test } from "vitest";
import * as shared from "./shared.js";
import * as own from "./one.js";
test("below vitest", () => {
  console.log(shared.seen());
  console.log(own.seen());
});
