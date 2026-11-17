import { mock, test } from "bun:test";
test("whether the load is refused", async () => {
  const original = await import("./wide.mjs");
  mock.module("./wide.mjs", () => ({ ...original, added: 3 }));
  console.log(await import("./top.mjs").then(it => ("mark" in it ? "shown " + String(it.mark) : "hidden"), error => error.name));
});
