import { test } from "bun:test";
import { notify } from "./service.ts";

test("uses the service", () => {
  console.log("a", notify());
});
