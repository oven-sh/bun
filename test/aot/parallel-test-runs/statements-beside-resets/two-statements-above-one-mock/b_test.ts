import { test } from "bun:test";
import { show } from "./page.ts";
import { load } from "./svc.ts";

test("shows", () => {
  console.log("b", show(), load());
});
