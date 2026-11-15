import { test } from "bun:test";
import { greet } from "./dep.cjs";
import { viaUser } from "./user.ts";

test("the next file", () => {
  console.log("next", greet(), viaUser());
});
