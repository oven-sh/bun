import { test } from "bun:test";
test("b", async () => {
  console.log("b", (await import("./services") as any).name(), (await import("./consumer")).call(), (await import("./f.cjs") as any).name());
});
