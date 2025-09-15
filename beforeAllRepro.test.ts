import { abc } from "./beforeAllImport";
import { test } from "bun:test";

test("test", () => {
  console.log("test");
  console.log(abc());
});

// ✓ should output "beforeAll" "test" "abc" even when `-t test` is passed
