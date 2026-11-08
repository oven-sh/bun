import { test } from "bun:test";
test("t", async () => {
  for (let turn = 0; turn < 2; turn++) {
    const got = await import("./box.cjs").then(
      m => [m.a, typeof m.reads, m.default === require("./box.cjs")],
      e => ["threw", String(e.message).slice(0, 40)],
    );
    console.log("b", turn, ...got);
  }
});
