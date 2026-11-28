import { test } from "bun:test";
test("t", async () => {
  const code = await import("./code.toml", { with: { type: "js" } });
  console.log(JSON.stringify([code.default, (await import("./code.toml")).default]));
});
