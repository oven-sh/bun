import { test } from "bun:test";
import { load } from "./x.cjs";
test("b", () => {
  console.log("one b " + load());
});
