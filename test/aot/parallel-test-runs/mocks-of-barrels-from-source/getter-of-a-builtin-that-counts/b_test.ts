import { test } from "bun:test";
import * as barrel from "./barrel";

test("the next file", () => {
  console.log("next", (barrel as any).ReadStream());
});
