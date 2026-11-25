// The exports of a CommonJS file are an object: a name that the file lacks is found on Object.prototype, where the test has laid it.
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
