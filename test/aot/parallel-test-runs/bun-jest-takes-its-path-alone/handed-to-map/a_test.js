import { test } from "bun:test";
test("map() hands an element, its index and the list", () => {
  const [mapped] = [import.meta.path].map(Bun.jest);
  console.log("SAID", typeof mapped, typeof mapped.expect, Object.keys(mapped).length > 5);
});
