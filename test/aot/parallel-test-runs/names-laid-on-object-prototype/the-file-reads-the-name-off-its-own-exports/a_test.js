// The text of the file itself asks its exports for the name.
import { test } from "bun:test";
import { peek } from "./reader.mjs";
test("a name laid above", () => {
  Object.prototype.extra = "from above";
  try {
    console.log(peek());
  } finally {
    delete Object.prototype.extra;
  }
  console.log(peek());
});
