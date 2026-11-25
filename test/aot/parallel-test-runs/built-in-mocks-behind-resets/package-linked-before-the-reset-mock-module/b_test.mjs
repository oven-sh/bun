import { test } from "bun:test";
import { platform } from "node:os";
test("b", () => console.log("b", typeof platform));
