import { test } from "bun:test";
import path from "node:path";

test("format() does not read a member from Object.prototype", () => {
  const ask = () => [path.posix.format({ dir: "/a", name: "b" }), path.win32.format({ __proto__: { base: "c" } })];
  console.log(ask());
  Object.prototype.base = "added";
  try {
    console.log(ask());
  } finally {
    delete Object.prototype.base;
  }
  console.log(ask());
});
