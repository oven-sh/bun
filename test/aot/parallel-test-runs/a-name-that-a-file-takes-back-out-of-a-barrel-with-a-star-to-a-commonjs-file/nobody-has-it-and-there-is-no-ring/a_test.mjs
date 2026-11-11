import { test } from "bun:test";
const show = all => Object.keys(all).join() + " " + String(all.round);
test("whether the load is refused", async () => {
  try {
    console.log("SAID", show(await import("./last.mjs")));
  } catch (error) {
    console.log("SAID", error.constructor.name, error.message);
  }
});
