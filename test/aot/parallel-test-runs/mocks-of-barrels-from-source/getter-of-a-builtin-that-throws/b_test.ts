import { test } from "bun:test";
import fs from "node:fs";

test("the next file", () => {
  console.log("next", (fs as any).ReadStream());
});
