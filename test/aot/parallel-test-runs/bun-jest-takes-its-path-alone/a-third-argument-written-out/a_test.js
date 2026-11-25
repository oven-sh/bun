import { test } from "bun:test";
test("whatever stands third", () => {
  const path = import.meta.path;
  console.log(
    "SAID",
    typeof Bun.jest(path, 0, [path]),
    typeof Bun.jest(path, true, true),
    typeof Bun.jest(path, false, 1),
  );
});
