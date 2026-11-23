import { test } from "bun:test";
import { load } from "./svc.ts";

test("loads", () => {
  console.log("b", load());
});
