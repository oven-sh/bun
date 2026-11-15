import { mock, test } from "bun:test";
test("whether the load is refused", async () => {
  mock.module("./wide.mjs", () => ({ mark: "mock" }));
  console.log(await import("./top.mjs").then(it => ("mark" in it ? "shown " + String(it.mark) : "hidden"), error => error.name));
});
