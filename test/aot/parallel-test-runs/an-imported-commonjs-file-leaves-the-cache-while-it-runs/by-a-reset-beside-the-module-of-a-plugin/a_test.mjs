import { test } from "bun:test";
import "./before.cjs";
import "./root.mjs";
test("t", async () => {
  try {
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
