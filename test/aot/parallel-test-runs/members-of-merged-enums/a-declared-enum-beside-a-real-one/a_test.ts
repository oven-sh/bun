import { test } from "bun:test";
import { read } from "./modes.ts";
declare enum Mode { Off, Fast }
enum Mode { Slow = 2 }
test("a member that `declare enum` lists is made by nobody", () => {
  console.log(Mode.Fast === 1 ? "folded" : "read at run time", String(Mode.Fast), Mode.Slow, read());
});
