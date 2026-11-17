import { test } from "bun:test";
import { send } from "./index.ts";

test("uses the client", () => {
  console.log("a", send());
});
