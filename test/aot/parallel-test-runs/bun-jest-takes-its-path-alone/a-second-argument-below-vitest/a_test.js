import { test } from "vitest";
test("whatever stands second", () => {
  const path = import.meta.path;
  console.log("SAID", typeof Bun.jest(path).suite, typeof Bun.jest(path, true).suite, typeof Bun.jest(path, 1).suite);
  console.log("SAID", Bun.jest(path, true) === Bun.jest(path));
});
