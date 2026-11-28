import { test } from "bun:test";
test("t", async () => {
  try {
    await import("./top.mjs");
    console.log(
      "later",
      (await import("./early.cjs")).v,
      (await import("./h.cjs")).v,
      require("./early.cjs").v,
      require("./h.cjs").v,
    );
    await import("./root.mjs");
  } catch (e) {
    console.log("caught", e.code ?? e.message);
  }
});
