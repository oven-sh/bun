import { test } from "bun:test";
import { send } from "./barrel.ts";

test("uses the client", () => {
  console.log("b", send());
});
