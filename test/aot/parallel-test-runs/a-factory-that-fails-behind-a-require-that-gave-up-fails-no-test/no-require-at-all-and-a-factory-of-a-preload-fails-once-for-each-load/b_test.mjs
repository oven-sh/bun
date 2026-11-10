import { test } from "bun:test";
test("b", async () => {
  console.log(await import("./torch.mjs").then(it => "got " + it.seen, error => error.message), globalThis.calls);
});
